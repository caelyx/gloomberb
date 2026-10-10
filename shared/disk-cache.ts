import type { PluginPersistence } from "gloomberb/types/plugin";
import { createPluginCache } from "gloomberb/utils";
import { cacheAge, CLOCK_SKEW_MS, type DiskCachePolicy } from "./cache-policy";

/** How old the data on screen is, and whether a refresh failed under it. */
export interface CacheMeta {
  /** When the source last answered for this copy (ms). */
  fetchedAt: number;
  /** Past its freshness window: a seeded copy not yet revalidated, or a refresh failed. */
  stale: boolean;
  /** The failed refresh, when the copy is a fallback. */
  refreshError?: string;
}

export interface Cached<T> extends CacheMeta {
  data: T;
  /** `cache`: served from memory or disk without a request; `network`: just fetched; `stale-fallback`: a refresh failed. */
  source: "cache" | "network" | "stale-fallback";
}

export interface DiskCodec<T, Stored> {
  encode: (value: T) => Stored;
  /** Throws on anything it does not recognise, so a corrupt or foreign entry is ignored rather than shown. */
  decode: (stored: Stored) => T;
}

export interface DiskCache<T> {
  readonly policy: DiskCachePolicy;
  attach(persistence: PluginPersistence | null): void;
  /** The copy on hand, without fetching: memory, then disk. Null once it is past `expireMs`. */
  peek(key: string, now?: number): Cached<T> | null;
  /**
   * Cache-first: a fresh copy is served as is; a stale one is refetched, and
   * if that fails the copy comes back flagged `stale` with the reason, until
   * it is past `expireMs`, when the error surfaces instead.
   *
   * Callers asking for the same key share one request, so the loader gets the
   * cache's own signal, not a caller's: it aborts only once every caller
   * waiting on the request has aborted. A caller's `signal` ends that caller's
   * wait alone. The HTTP client's timeout bounds a request nobody abandons.
   */
  load(key: string, loader: (signal: AbortSignal) => Promise<T>, options?: { force?: boolean; signal?: AbortSignal }): Promise<Cached<T>>;
}

const registry = new Set<DiskCache<unknown>>();

/** Points every disk cache at the plugin's persistence; `setup()` calls this once. */
export function attachDiskCaches(persistence: PluginPersistence | null): void {
  for (const cache of registry) cache.attach(persistence);
}

const INDEX_SCHEMA = 1;
const MAX_MISSES = 2_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/** The callers waiting on one key's request; the request is abandoned when the last of them aborts. */
interface Flight {
  waiting: number;
  controller: AbortController | null;
}

/**
 * Gloomberb's plugin cache (`createPluginCache`, which keeps entries in the
 * host's resource store: SQLite on the terminal and desktop, memory on the
 * web) with the plugin's policy table, a per-kind entry bound and a memory
 * layer for synchronous readers such as list columns. Without persistence
 * (`gloomberb fn`, tests) it is a memory cache with the same freshness rules.
 */
export function createDiskCache<T, Stored = T>(policy: DiskCachePolicy, codec?: DiskCodec<T, Stored>): DiskCache<T> {
  const inner = createPluginCache<T, Stored>({
    kind: policy.kind,
    source: policy.source,
    schemaVersion: policy.schemaVersion,
    policy: { staleMs: policy.staleMs, expireMs: policy.expireMs },
    ...(codec ? { encode: codec.encode, decode: codec.decode } : {}),
  });
  let persistence: PluginPersistence | null = null;
  const memory = new Map<string, { data: T; fetchedAt: number }>();
  const misses = new Set<string>();
  const flights = new Map<string, Flight>();
  /** Requests abandoned but not yet settled; the next caller starts afresh rather than joining one. */
  const abandoned = new Map<string, AbortController>();

  function remember(key: string, data: T, fetchedAt: number): void {
    memory.delete(key);
    memory.set(key, { data, fetchedAt });
    misses.delete(key);
    while (memory.size > policy.maxEntries) memory.delete(memory.keys().next().value!);
  }

  /** Most recently fetched last; past `maxEntries` the oldest entries leave the disk. */
  function touch(key: string): void {
    if (!persistence) return;
    const indexKey = `cache-index:${policy.kind}`;
    const stored = persistence.getState<unknown>(indexKey, { schemaVersion: INDEX_SCHEMA });
    // A damaged index starts over rather than failing a load that succeeded.
    const index = (Array.isArray(stored) ? stored : []).filter((entry): entry is string => typeof entry === "string" && entry !== key);
    index.push(key);
    while (index.length > policy.maxEntries) {
      const evicted = index.shift()!;
      persistence.deleteResource(policy.kind, evicted, { sourceKey: policy.source });
      memory.delete(evicted);
    }
    persistence.setState(indexKey, index, { schemaVersion: INDEX_SCHEMA });
  }

  const cache: DiskCache<T> = {
    policy,
    attach(next) {
      if (next === persistence) return;
      memory.clear();
      misses.clear();
      if (next) inner.attach(next);
      else inner.reset();
      persistence = next;
    },
    peek(key, now = Date.now()) {
      let entry = memory.get(key) ?? null;
      if (!entry && !misses.has(key)) {
        // A copy that fails to decode reads as absent.
        const stored = inner.get(key);
        if (stored) {
          entry = { data: stored.data, fetchedAt: stored.fetchedAt };
          remember(key, stored.data, stored.fetchedAt);
        } else {
          if (misses.size >= MAX_MISSES) misses.clear();
          misses.add(key);
        }
      }
      if (!entry) return null;
      const age = cacheAge(entry.fetchedAt, policy, now);
      return age === "expired" ? null : { data: entry.data, fetchedAt: entry.fetchedAt, stale: age === "stale", source: "cache" };
    },
    async load(key, loader, options = {}) {
      const { signal } = options;
      if (signal?.aborted) throw abortError(signal);
      let force = options.force ?? false;
      // A copy dated ahead of the clock (written under a skewed clock) is refetched, not trusted as fresh.
      const held = force ? null : cache.peek(key);
      if (held && held.fetchedAt - Date.now() > CLOCK_SKEW_MS) force = true;

      let flight = flights.get(key);
      if (!flight) {
        flight = { waiting: 0, controller: null };
        flights.set(key, flight);
      }
      const own = flight;
      own.waiting += 1;
      let done = false;
      const leave = (aborted: boolean) => {
        if (done) return;
        done = true;
        own.waiting -= 1;
        if (own.waiting > 0) return;
        if (flights.get(key) === own) flights.delete(key);
        if (aborted && own.controller) {
          abandoned.set(key, own.controller);
          own.controller.abort();
        }
      };
      let started: AbortController | null = null;
      const shared = inner.load(key, () => {
        const controller = new AbortController();
        started = controller;
        own.controller = controller;
        // Everyone left before the request started.
        if (own.waiting === 0) controller.abort();
        if (controller.signal.aborted) return Promise.reject(abortError(controller.signal));
        return loader(controller.signal);
      }, { force, replace: abandoned.has(key) }).finally(() => {
        // Settled here, the host no longer holds the request, so it can be joined again.
        if (started && abandoned.get(key) === started) abandoned.delete(key);
        leave(false);
      });

      let result: Awaited<typeof shared>;
      if (!signal) {
        result = await shared;
      } else {
        result = await new Promise<Awaited<typeof shared>>((resolve, reject) => {
          const onAbort = () => {
            leave(true);
            reject(abortError(signal));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
        });
      }

      if (result.source === "stale-fallback") {
        const age = cacheAge(result.fetchedAt, policy);
        if (age === "expired") throw result.error ?? new Error(result.refreshError ?? "Request failed");
        // An earlier `r` that failed over a copy still in its window is not news to a plain load.
        if (age === "fresh" && !force) {
          remember(key, result.data, result.fetchedAt);
          return { data: result.data, fetchedAt: result.fetchedAt, stale: false, source: "cache" };
        }
        return { data: result.data, fetchedAt: result.fetchedAt, stale: true, refreshError: result.refreshError ?? message(result.error), source: result.source };
      }
      remember(key, result.data, result.fetchedAt);
      if (result.source === "network") touch(key);
      return { data: result.data, fetchedAt: result.fetchedAt, stale: false, source: result.source };
    },
  };
  registry.add(cache as DiskCache<unknown>);
  return cache;
}

/** Several cached parts shown together (three RBA tables): as old as the oldest, stale if any part is. An empty label adds no prefix. */
export function combineMeta(parts: ReadonlyArray<{ label: string; meta: CacheMeta } | null>): CacheMeta | null {
  const present = parts.filter((part): part is { label: string; meta: CacheMeta } => part !== null);
  if (present.length === 0) return null;
  const errors = present.filter((part) => part.meta.refreshError).map((part) => (part.label ? `${part.label}: ${part.meta.refreshError}` : part.meta.refreshError!));
  return {
    fetchedAt: Math.min(...present.map((part) => part.meta.fetchedAt)),
    stale: present.some((part) => part.meta.stale),
    ...(errors.length ? { refreshError: errors.join("; ") } : {}),
  };
}

// Codec helpers: each throws on a shape it does not expect.

export function expectArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Cached ${what} is not a list`);
  return value;
}

export function expectString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`Cached ${what} is not text`);
  return value;
}

export function expectNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Cached ${what} is not a number`);
  return value;
}

export function nullableString(value: unknown, what: string): string | null {
  return value === null ? null : expectString(value, what);
}

export function nullableNumber(value: unknown, what: string): number | null {
  return value === null ? null : expectNumber(value, what);
}

/** Dated points as two parallel columns, about half the size of an object per point. */
export type StoredPoints = [dates: string[], values: number[]];

export function encodePoints<P extends { date: string; value: number }>(points: readonly P[]): StoredPoints {
  return [points.map((point) => point.date), points.map((point) => point.value)];
}

export function decodePoints(stored: unknown, what: string): Array<{ date: string; value: number }> {
  const [dates, values] = expectArray(stored, what);
  const dateList = expectArray(dates, what);
  const valueList = expectArray(values, what);
  if (dateList.length !== valueList.length) throw new Error(`Cached ${what} columns differ in length`);
  return dateList.map((date, index) => ({ date: expectString(date, what), value: expectNumber(valueList[index], what) }));
}
