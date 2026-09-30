import { createPluginCache } from "gloomberb/utils";
import type { GloomPluginContext } from "gloomberb/types/plugin";

type PluginPersistence = GloomPluginContext["persistence"];
import { fetchGoogleSection } from "./google-news";
import type { Headline } from "./types";

/**
 * One cache in front of Google News, shared by the pane and the `news`
 * capability.
 *
 * It is not an optimisation. The host's news aggregator polls every tracked
 * query every two minutes while the app is visible and fans out to every
 * enabled source, so an uncached provider turns one open News pane into four
 * RSS requests a minute, forever, whether or not this plugin's own pane is
 * open. Google answers that with 503s. `createPluginCache` also coalesces
 * concurrent loads of the same key, so the pane and the aggregator asking at
 * once cost one request between them.
 */
const STALE_MS = 15 * 60 * 1000;
/** Matches the pane's own refresh cadence, so the aggregator's two-minute
 * polls are answered from cache for the whole interval.
 *
 * Kept well past stale so a rate-limited refresh can still draw the last good
 * board rather than an empty one. */
const EXPIRE_MS = 60 * 60 * 1000;

/**
 * Keyed by one section, not by a set of them.
 *
 * The pane draws four sections and the `news` capability serves two, and they
 * overlap. A per-set key would fetch Business and Tech twice, once under each
 * caller's key; per-section they share the entry. It also means adding a
 * section to the pane fetches that section alone rather than all of them
 * again.
 *
 * Headline is plain JSON — publishedAt is a number, not a Date — so it
 * round-trips through persistence without an encoder.
 */
const feedCache = createPluginCache<Headline[]>({
  kind: "newsmap-section",
  source: "google-news",
  schemaVersion: 1,
  policy: { staleMs: STALE_MS, expireMs: EXPIRE_MS },
});

export function attachNewsmapCache(persistence: PluginPersistence): void {
  feedCache.attach(persistence);
}

export function resetNewsmapCache(): void {
  feedCache.reset();
}

export function sectionKey(section: string, editionId: string): string {
  return `${editionId}:${section}`;
}

export interface LoadedFeed {
  headlines: Headline[];
  /** Sections whose feed failed. A partial board beats an empty one. */
  failedSections: string[];
  fetchedAt: number;
  stale: boolean;
}

/** The last board for these sections, however old, so a reopened pane paints
 * before the network answers. */
export function cachedFeed(sections: readonly string[], editionId: string): { headlines: Headline[] } | null {
  const headlines: Headline[] = [];
  for (const section of sections) {
    const hit = feedCache.get(sectionKey(section, editionId), { allowExpired: true });
    if (hit) headlines.push(...hit.data);
  }
  return headlines.length > 0 ? { headlines } : null;
}

export async function loadFeed(
  sections: readonly string[],
  editionId: string,
  { force = false } = {},
): Promise<LoadedFeed> {
  const settled = await Promise.allSettled(sections.map((section) => feedCache.load(
    sectionKey(section, editionId),
    // No caller's abort signal: the entry is shared, so one caller walking away
    // must not cancel the fetch for everyone. google-news.ts has its own
    // timeout, and createPluginCache coalesces concurrent loads of a key.
    () => fetchGoogleSection(section, editionId),
    { force },
  )));

  const headlines: Headline[] = [];
  const failedSections: string[] = [];
  let fetchedAt = 0;
  let stale = false;
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      failedSections.push(sections[index] ?? "unknown");
      return;
    }
    headlines.push(...result.value.data);
    // The board is only as fresh as its oldest section.
    fetchedAt = fetchedAt === 0 ? result.value.fetchedAt : Math.min(fetchedAt, result.value.fetchedAt);
    stale = stale || result.value.stale;
  });

  return { headlines, failedSections, fetchedAt: fetchedAt || Date.now(), stale };
}
