import { httpFetch } from "gloomberb/utils";
import { parseGoogleNewsFeed, feedUrl } from "./parse";
import type { Headline } from "./types";

const REQUEST_TIMEOUT_MS = 12_000;

export { feedUrl, parseGoogleNewsFeed, decodeEntities } from "./parse";

/**
 * One section's feed. Fanning out across sections, and tolerating one of them
 * failing, is cache.ts's job — it caches per section so the pane and the news
 * capability share the sections they have in common rather than each fetching
 * their own set.
 */
export async function fetchGoogleSection(
  section: string,
  editionId: string,
  signal?: AbortSignal,
): Promise<Headline[]> {
  const response = await httpFetch(feedUrl(section, editionId), {
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" },
  });
  // Google answers a hammered feed with a 503, which must fail this section
  // rather than parse to an empty one and look like a quiet news day.
  if (!response.ok) throw new Error(`Google News ${section} returned ${response.status}`);
  return parseGoogleNewsFeed(await response.text(), section);
}
