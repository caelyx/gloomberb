/**
 * Every source the plugin keeps on disk, in one place, so a pane opens with
 * its last data and refreshes behind it. `staleMs` is how long a copy is
 * served without asking the source again (matched to how often the source
 * publishes); `expireMs` is the oldest copy a pane will show at all, at open
 * or when a refresh fails. `maxEntries` bounds keyed kinds (one entry per
 * ticker or day). Bump `schemaVersion` whenever a kind's stored shape
 * changes: older copies are then dropped instead of misread.
 *
 * Not kept on disk: NEM prices, the current generation mix and the price chart
 * series (five-minute dispatch, so a saved copy is wrong by the time it shows), quotes and price history (the host's), news
 * feeds (the host's news pane keeps its own), options chains, ASX search and
 * the heatmap's boards (quotes). docs/caching.md has the reasoning per source.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DiskCachePolicy {
  /** Resource kind in plugin persistence. */
  kind: string;
  /** Who published the data; part of the stored key. */
  source: string;
  schemaVersion: number;
  staleMs: number;
  expireMs: number;
  /** Most entries kept for this kind; the least recently fetched go first. */
  maxEntries: number;
}

export const CACHE_POLICY = {
  /** F1 and F11.1 move each business day, F2 too; an hour keeps a pane current through the afternoon update. */
  rbaTable: { kind: "rba-table", source: "rba", schemaVersion: 1, staleMs: HOUR, expireMs: 30 * DAY, maxEntries: 3 },
  /** ASX settles the cash rate futures once a business day (prices are delayed 20 minutes during the day); 15 minutes follows the day session. */
  ibFutures: { kind: "ib-futures", source: "asx", schemaVersion: 1, staleMs: 15 * MINUTE, expireMs: 7 * DAY, maxEntries: 1 },
  /** One settled strip per settlement day, for the 1W, 1M and 1Y look-backs; a day's settlement never changes. */
  ibSnapshot: { kind: "ib-snapshot", source: "asx", schemaVersion: 1, staleMs: 400 * DAY, expireMs: 400 * DAY, maxEntries: 400 },
  /** Monthly and quarterly releases at 11:30 am; six hours catches a release day. */
  absSeries: { kind: "abs-series", source: "abs", schemaVersion: 1, staleMs: 6 * HOUR, expireMs: 120 * DAY, maxEntries: 40 },
  absCalendar: { kind: "abs-calendar", source: "abs", schemaVersion: 1, staleMs: 6 * HOUR, expireMs: 14 * DAY, maxEntries: 1 },
  /** ASIC posts one report a business day (T+4); the index says which days exist. */
  asicIndex: { kind: "asic-short-index", source: "asic", schemaVersion: 1, staleMs: HOUR, expireMs: 14 * DAY, maxEntries: 1 },
  /** A published day never changes. About 50 KB each; the 3M window (~65 days) and the weekly 1Y window (~53) fit. */
  asicDay: { kind: "asic-short-day", source: "asic", schemaVersion: 1, staleMs: 365 * DAY, expireMs: 365 * DAY, maxEntries: 150 },
  /** AusTender publishes through the day; one entry per window. */
  contracts: { kind: "austender-window", source: "austender", schemaVersion: 1, staleMs: 30 * MINUTE, expireMs: 7 * DAY, maxEntries: 4 },
  /** The company directory and the fund list change daily at most. */
  directory: { kind: "asx-directory", source: "asx", schemaVersion: 1, staleMs: 12 * HOUR, expireMs: 14 * DAY, maxEntries: 1 },
  funds: { kind: "asx-funds", source: "tmx", schemaVersion: 1, staleMs: 12 * HOUR, expireMs: 14 * DAY, maxEntries: 1 },
  /** Dividend details change a few times a year; one entry per code, for the portfolio columns. */
  franking: { kind: "asx-franking", source: "asx", schemaVersion: 1, staleMs: 6 * HOUR, expireMs: 30 * DAY, maxEntries: 500 },
  /** Index membership changes at quarterly rebalances; a fortnight-old list is still nearly right. */
  heatmapMembers: { kind: "asx200-members", source: "tradingview", schemaVersion: 1, staleMs: DAY, expireMs: 14 * DAY, maxEntries: 1 },
  /** The market-wide announcement feed: all or price-sensitive, at the pane's and the news feed's lengths. */
  marketAnnouncements: { kind: "asx-market-feed", source: "asx", schemaVersion: 1, staleMs: 2 * MINUTE, expireMs: DAY, maxEntries: 4 },
  /** One company's feed, a page at a time (item 11). */
  feedPage: { kind: "asx-feed-page", source: "asx", schemaVersion: 1, staleMs: 15 * MINUTE, expireMs: 7 * DAY, maxEntries: 300 },
  /**
   * NEM generation by fuel: the 48-hour (hourly), 3-month (daily) and 12-month
   * (weekly) reports, one entry each. AEMO adds a trading day once it closes
   * (04:00 AEST), so a few hours is fresh enough; about 100 KB each.
   */
  nemFuelHistory: { kind: "nem-fuel-history", source: "aemo", schemaVersion: 1, staleMs: 3 * HOUR, expireMs: 14 * DAY, maxEntries: 3 },
  /**
   * OpenElectricity (only with an API key): rooftop solar and battery charging
   * and discharging for every region. Each request costs credits (500 a day on
   * the free plan), so copies are kept longer than the data's own interval:
   * the last 24 hours at 5 minutes for ten minutes, and the history windows,
   * which match AEMO's (past days only), for twelve hours.
   */
  openElectricityRecent: { kind: "oe-recent", source: "openelectricity", schemaVersion: 1, staleMs: 10 * MINUTE, expireMs: 6 * HOUR, maxEntries: 1 },
  openElectricityHistory: { kind: "oe-history", source: "openelectricity", schemaVersion: 1, staleMs: 12 * HOUR, expireMs: 14 * DAY, maxEntries: 6 },
  /** A published PDF does not change. */
  extract: { kind: "asx-extract", source: "asx", schemaVersion: 1, staleMs: 30 * DAY, expireMs: 90 * DAY, maxEntries: 1_000 },
} as const satisfies Record<string, DiskCachePolicy>;

export type CacheAge = "fresh" | "stale" | "expired";

/** A copy dated further ahead of the clock than this was written under a skewed clock: stale, so it is refetched. */
export const CLOCK_SKEW_MS = 5 * MINUTE;

/** How a copy fetched at `fetchedAt` stands under a policy. */
export function cacheAge(fetchedAt: number, policy: Pick<DiskCachePolicy, "staleMs" | "expireMs">, now = Date.now()): CacheAge {
  const age = now - fetchedAt;
  if (!Number.isFinite(age) || age >= policy.expireMs) return "expired";
  return age >= policy.staleMs || age < -CLOCK_SKEW_MS ? "stale" : "fresh";
}
