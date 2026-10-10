import { createThrottledFetch } from "gloomberb/utils";

/**
 * Some hosts refuse Bun's default `Bun/x` user agent (the RBA), and some reset
 * the connection when the agent carries a URL (the TGA). Browsers and the
 * desktop view drop this header and send their own, which every host accepts.
 */
export const USER_AGENT = "Mozilla/5.0 (compatible; gloom-au/0.1)";

/**
 * One polite client for most AU sources. The public ASX, RBA, ABS and ASIC
 * endpoints publish no rate limits, so stay well under anything a browser
 * session would do. `createThrottledFetch` goes through `httpFetch`, which
 * the desktop app routes through its Bun process (no CORS there).
 */
const client = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 20_000,
  defaultHeaders: { Accept: "application/json, text/csv, text/html;q=0.9, */*;q=0.8", "User-Agent": USER_AGENT },
});

/** `rba.gov.au` from a URL, for error messages that say which source failed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

/** A source answered with an HTTP error. */
export class HttpStatusError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`${hostOf(url)} request failed (${status})`);
    this.name = "HttpStatusError";
  }
}

export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await client.fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return response.text();
}

/** A binary body (a PDF). */
export async function fetchBytes(url: string, accept: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await client.fetch(url, { headers: { Accept: accept }, ...(signal ? { signal } : {}) });
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const text = await fetchText(url, signal);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The response was not JSON");
  }
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

/**
 * A small in-memory TTL cache with in-flight dedupe. `force` skips a fresh
 * entry. A failed load falls back to a cached value up to `maxStaleMs` old, so
 * a refresh never blanks a pane over a passing outage; past that the error
 * surfaces rather than old figures passing for current ones.
 */
export function createMemoryCache<T>(ttlMs: number, maxEntries = 200, maxStaleMs = Math.max(ttlMs * 6, 24 * 60 * 60_000)) {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  async function load(key: string, loader: () => Promise<T>, force = false): Promise<T> {
    const cached = entries.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < ttlMs) return cached.value;
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = loader()
      .then((value) => {
        entries.delete(key);
        entries.set(key, { value, fetchedAt: Date.now() });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
        return value;
      })
      .catch((error) => {
        if (cached && Date.now() - cached.fetchedAt < maxStaleMs) return cached.value;
        throw error;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return {
    load,
    /** Whatever is cached, fresh or not, without fetching. */
    peek: (key: string) => entries.get(key)?.value ?? null,
    isFresh: (key: string) => {
      const entry = entries.get(key);
      return !!entry && Date.now() - entry.fetchedAt < ttlMs;
    },
  };
}
