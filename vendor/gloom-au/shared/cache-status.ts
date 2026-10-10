import { useCallback, useMemo, useRef } from "react";
import type { PaneFooterSegment } from "gloomberb/components";
import { useAsyncResource, useUpdatedAgo } from "gloomberb/react";
import type { CacheMeta } from "./disk-cache";

export interface CacheStatus {
  /** `updated 3h ago`, from when the source last answered (not when the pane loaded it from disk). */
  info: PaneFooterSegment[];
  /** For the shared `stale` footer warning: only once a refresh has had its chance. */
  stale: boolean;
  /** For the amber notice: why the copy on screen could not be replaced. */
  notices: string[];
}

/** The notice for a copy a refresh could not replace; headless reports add it to their notes. */
export function refreshNotice(meta: CacheMeta | null | undefined): string[] {
  return meta?.refreshError ? [`Refresh failed, showing the last copy: ${meta.refreshError}`] : [];
}

/** Footer pieces for a pane showing cached data: its age, `stale`, and a failed refresh. */
export function useCacheStatus(meta: CacheMeta | null | undefined, loading: boolean): CacheStatus {
  const ago = useUpdatedAgo(meta?.fetchedAt ?? null);
  const stale = !!meta?.stale && !loading;
  const refreshError = meta?.refreshError;
  return useMemo(() => ({
    info: ago ? [{ id: "updated", parts: [{ text: `updated ${ago}`, tone: "muted" as const }] }] : [],
    stale,
    notices: refreshError ? [`Refresh failed, showing the last copy: ${refreshError}`] : [],
  }), [ago, refreshError, stale]);
}

/**
 * A resource with one disk copy per key (a window, a filter). The copy for a
 * new key paints as soon as the key changes; the previous key's data stands
 * in, loading, only when there is no copy. `fetch` and `cached` are read
 * through a ref, so only the key decides when to load.
 */
export function useKeyedCachedResource<K extends string, T>(
  key: K,
  fetch: (key: K, force: boolean) => Promise<T>,
  cached: (key: K) => T | null,
) {
  const fns = useRef({ fetch, cached });
  fns.current = { fetch, cached };
  const loader = useCallback(async (force: boolean): Promise<{ key: K; value: T }> => ({ key, value: await fns.current.fetch(key, force) }), [key]);
  const initialData = useCallback((): { key: K; value: T } | null => {
    const value = fns.current.cached(key);
    return value === null ? null : { key, value };
  }, [key]);
  const resource = useAsyncResource(loader, { keepPreviousData: true, initialData });
  const held = resource.data;
  const disk = useMemo(() => (held?.key === key ? null : fns.current.cached(key)), [held, key]);
  return { ...resource, data: keyedValue(key, held, disk) };
}

/** What a keyed pane shows: its own key's data, else that key's disk copy, else the previous key's data. */
export function keyedValue<K, T>(key: K, held: { key: K; value: T } | null, disk: T | null): T | null {
  if (held?.key === key) return held.value;
  return disk ?? held?.value ?? null;
}
