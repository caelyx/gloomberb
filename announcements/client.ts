import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectArray, expectNumber, expectString, type Cached, type DiskCodec } from "../shared/disk-cache";
import { createMemoryCache, fetchJson, fetchText } from "../shared/http";
import { sydneyYear } from "../shared/time";
import {
  companyAnnouncementsUrl,
  parseCompanyAnnouncementsHtml,
  parseMarketAnnouncementsJson,
  type AnnouncementPeriod,
  type AsxAnnouncement,
} from "./model";

const MARKET_FEED_URL = "https://asx.api.markitdigital.com/asx-research/1.0/markets/announcements";

/** Announcements land through the trading day; five minutes keeps a pane current without hammering ASX. */
const companyCache = createMemoryCache<AsxAnnouncement[]>(5 * 60_000);

/** Stored as parsed, with the fields every view reads checked on the way back. */
export const announcementsCodec: DiskCodec<AsxAnnouncement[], AsxAnnouncement[]> = {
  encode: (items) => items,
  decode: (stored) => expectArray(stored, "announcements").map((item) => {
    const record = item as AsxAnnouncement;
    if (!record || typeof record !== "object" || typeof record.priceSensitive !== "boolean" || !Array.isArray(record.types)) throw new Error("Cached announcement is not recognised");
    expectString(record.id, "announcement id");
    expectString(record.code, "announcement code");
    expectString(record.headline, "headline");
    expectString(record.category, "category");
    expectNumber(record.releasedAt, "release time");
    return record;
  }),
};

/** Kept on disk, so ASXA opens with the last list; see CACHE_POLICY.marketAnnouncements. */
const marketCache = createDiskCache(CACHE_POLICY.marketAnnouncements, announcementsCodec);

export interface LoadOptions {
  force?: boolean;
  signal?: AbortSignal;
}

/** One company's announcements: the last six months, or one calendar year. */
export function loadCompanyAnnouncements(
  code: string,
  period: AnnouncementPeriod = "M6",
  options: LoadOptions = {},
): Promise<AsxAnnouncement[]> {
  const normalized = code.trim().toUpperCase();
  // A past year no longer changes; only the current window needs refreshing.
  const force = options.force && (period === "M6" || Number(period) >= sydneyYear());
  return companyCache.load(`${normalized}:${period}`, async () => (
    parseCompanyAnnouncementsHtml(await fetchText(companyAnnouncementsUrl(normalized, period), options.signal), normalized)
  ), force);
}

export interface MarketFeedQuery {
  priceSensitiveOnly?: boolean;
  /** At most 500 per request; the feed holds the last 10,000. */
  limit?: number;
}

function marketSearch(query: MarketFeedQuery): URLSearchParams {
  const limit = Math.max(1, Math.min(500, Math.round(query.limit ?? 200)));
  const search = new URLSearchParams({ itemsPerPage: String(limit) });
  if (query.priceSensitiveOnly) search.set("priceSensitiveOnly", "true");
  return search;
}

/** The latest announcements across the market, with the copy's age. */
export function loadMarketFeed(query: MarketFeedQuery = {}, options: LoadOptions = {}): Promise<Cached<AsxAnnouncement[]>> {
  const search = marketSearch(query);
  return marketCache.load(search.toString(), async (signal) => (
    parseMarketAnnouncementsJson(await fetchJson<unknown>(`${MARKET_FEED_URL}?${search}`, signal))
  ), options);
}

/** The latest announcements across the market. */
export async function loadMarketAnnouncements(query: MarketFeedQuery = {}, options: LoadOptions = {}): Promise<AsxAnnouncement[]> {
  return (await loadMarketFeed(query, options)).data;
}

/** The feed on disk, for a pane's first paint. */
export function cachedMarketFeed(query: MarketFeedQuery = {}): Cached<AsxAnnouncement[]> | null {
  return marketCache.peek(marketSearch(query).toString());
}
