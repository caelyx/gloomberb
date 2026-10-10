import type { DataProvider, QuoteBatchResult, QuoteSubscriptionTarget } from "gloomberb/types/data-provider";
import { createThrottledFetch, type ThrottledFetchTransport } from "gloomberb/utils";
import { loadAsxDirectory } from "../directory/client";
import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectArray, expectString, nullableNumber, type DiskCodec } from "../shared/disk-cache";
import { createMemoryCache, HttpStatusError, USER_AGENT } from "../shared/http";
import { sectorForIndustryGroup } from "./gics";
import {
  axSymbol,
  companyAsset,
  parseIndexScan,
  quotesFromBatch,
  rankByMarketCap,
  SECTOR_INDICES,
  sectorIndexAssets,
  UNIVERSE_SIZE,
  type ConstituentSource,
  type Constituent,
  type HeatmapAsset,
  type HeatmapUniverse,
  type Listing,
  type TileQuote,
} from "./model";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** TradingView's stock scanner; keyless, and not a documented API. */
export const INDEX_SCAN_URL = "https://scanner.tradingview.com/australia/scan";

export function indexScanBody(): unknown {
  return {
    symbols: { query: { types: [] }, tickers: [], groups: [{ type: "index", values: ["ASX:XJO"] }] },
    columns: ["name", "description", "market_cap_basic", "indexes"],
    // The index has 200 members; the margin keeps a rebalance week from cutting the list short.
    range: [0, 300],
  };
}

/**
 * Gloom Cloud refuses a signed-out batch of 199 symbols ("Anonymous market
 * batch limit exceeded") and takes 100, so larger lists go in chunks.
 */
export const QUOTE_BATCH_SIZE = 100;

/** Gloom Cloud's signed-out rate limit, in an error, its cause chain, or an error the host passed on as a string. */
export function isRateLimited(error: unknown): boolean {
  if (typeof error === "string") return /rate limit|\b429\b/i.test(error);
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const { status, message, cause } = current as { status?: unknown; message?: unknown; cause?: unknown };
    if (status === 429 || (typeof message === "string" && /rate limit/i.test(message))) return true;
    current = cause;
  }
  return false;
}

export interface QuoteFetch {
  quotes: Map<string, TileQuote>;
  /** Symbols that came back without a quote; a later load may get them. */
  failed: number;
  rateLimited: boolean;
  /** The first reason the host gave for a missing quote. */
  error?: string;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "");

/**
 * Batches go one after another, not in parallel, to stay under the signed-out
 * rate limit. The host's batch call does not throw when Gloom Cloud refuses a
 * batch: it asks for each name on its own and returns whatever it got, with a
 * reason on each miss. So a miss is a requested symbol that came back without
 * a quote, and once a batch hits the rate limit the rest are not asked for,
 * since each would fan out into a hundred refused single requests.
 */
export async function fetchQuotes(provider: Pick<DataProvider, "getQuotesBatch" | "getQuote">, targets: readonly QuoteSubscriptionTarget[], force = false): Promise<QuoteFetch> {
  const quotes = new Map<string, TileQuote>();
  let failed = 0;
  let rateLimited = false;
  let error: string | undefined;
  for (let start = 0; start < targets.length; start += QUOTE_BATCH_SIZE) {
    const batch = targets.slice(start, start + QUOTE_BATCH_SIZE);
    if (rateLimited) {
      failed += batch.length;
      continue;
    }
    let results: QuoteBatchResult[];
    try {
      results = provider.getQuotesBatch
        ? await provider.getQuotesBatch(batch, { forceRefresh: force })
        : await Promise.all(batch.map(async (target) => {
          try {
            return { target, quote: await provider.getQuote(target.symbol, target.exchange) };
          } catch (cause) {
            return { target, quote: null, error: cause as Error };
          }
        }));
    } catch (cause) {
      // Another host might throw for the whole batch.
      results = batch.map((target) => ({ target, quote: null, error: cause as Error }));
    }
    const got = quotesFromBatch(results);
    for (const [symbol, quote] of got) quotes.set(symbol, quote);
    for (const target of batch) if (!got.has(target.symbol.toUpperCase())) failed += 1;
    for (const result of results) {
      if (result?.quote || result?.error == null) continue;
      error ??= errorText(result.error) || undefined;
      if (isRateLimited(result.error)) rateLimited = true;
    }
  }
  return { quotes, failed, rateLimited, ...(error ? { error } : {}) };
}

const companyTarget = (code: string): QuoteSubscriptionTarget => ({ symbol: axSymbol(code), exchange: "ASX", surface: "screener" });

export interface HeatmapBoard {
  universe: HeatmapUniverse;
  assets: HeatmapAsset[];
  /** Constituents (or, on the Sectors board, sector weights) came from a market-cap ranking, not the index scan. */
  ranked: boolean;
  /** Why the scan was not used although it was asked for; the board fell back to the ranking. */
  fallback: string | null;
  /** Names left off because their quote batch failed. */
  missingQuotes: number;
  rateLimited: boolean;
  /** The directory could not be loaded, so no tile has a sector (on the Sectors board: the sectors are sized evenly). */
  sectorsUnavailable: boolean;
  /** Set when the scan failed and an older member list stood in: when that list was fetched. */
  membersAsOf: number | null;
  /** Newest quote time. */
  asOf: number | null;
  /** When the board was built. */
  builtAt: number;
  /** Set on a board kept from an earlier load because the latest refresh failed: why it failed. */
  refreshError: string | null;
}

export interface HeatmapLoadOptions {
  universe: HeatmapUniverse;
  source: ConstituentSource;
  force?: boolean;
}

export interface HeatmapDeps {
  /** Test seam for the scan request; production goes through Gloomberb's `httpFetch`. */
  transport?: ThrottledFetchTransport;
  directory?: () => Promise<Listing[]>;
  now?: () => number;
}

export const membersCodec: DiskCodec<Constituent[], Array<[code: string, name: string, marketCap: number | null, inAsx50: boolean]>> = {
  encode: (members) => members.map((member) => [member.code, member.name, member.marketCap, member.inAsx50]),
  decode: (stored) => {
    const members = expectArray(stored, "index members").map((entry): Constituent => {
      const [code, name, marketCap, inAsx50] = expectArray(entry, "index member");
      if (typeof inAsx50 !== "boolean") throw new Error("Cached index member has no ASX 50 flag");
      return { code: expectString(code, "member code"), name: expectString(name, "member name"), marketCap: nullableNumber(marketCap, "member market cap"), inAsx50 };
    });
    if (members.length === 0) throw new Error("Cached index members are empty");
    return members;
  },
};

/** A scan listing fewer members than these is treated as failed: a rebalance moves a few names, not dozens. */
const MIN_MEMBERS = { asx50: 45, asx200: 150 } as const;

/** How long a board stands in, marked as a failed refresh, when rebuilding it fails. */
const KEEP_BOARD_MS = 10 * MINUTE;

/** A failed scan is not asked again for this long, so a blocked scanner costs one request per ten minutes. */
const SCAN_RETRY_MS = 10 * MINUTE;

function scanFailure(error: unknown): string {
  if (error instanceof HttpStatusError) return `request failed (${error.status})`;
  return error instanceof Error && error.message ? error.message : "request failed";
}

/**
 * Loads boards. Membership is cached for a day (an index rebalances
 * quarterly), the market-cap ranking for twelve hours, and a whole board for
 * a minute, since the quotes behind it are delayed anyway.
 */
export function createHeatmapLoader(deps: HeatmapDeps = {}) {
  const now = deps.now ?? Date.now;
  const http = createThrottledFetch({
    requestsPerMinute: 10,
    maxRetries: 1,
    timeoutMs: 10_000,
    defaultHeaders: { "User-Agent": USER_AGENT },
    ...(deps.transport ? { transport: deps.transport } : {}),
  });
  const directory = deps.directory ?? (() => loadAsxDirectory());
  // Kept on disk for a day, and shown for a fortnight if the scan breaks: membership changes quarterly.
  const members = createDiskCache(CACHE_POLICY.heatmapMembers, membersCodec);
  // No stale fallback inside the cache: `load` keeps the last board itself, marked as a failed refresh.
  const boards = createMemoryCache<HeatmapBoard>(MINUTE, 6, 0);
  let scanFailedAt: { at: number; reason: string } | null = null;
  let ranking: { at: number; ttl: number; listings: Listing[] } | null = null;

  async function scan(): Promise<Constituent[]> {
    const response = await http.fetch(INDEX_SCAN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(indexScanBody()),
    });
    if (!response.ok) throw new HttpStatusError(response.status, INDEX_SCAN_URL);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error("the response was not JSON");
    }
    const parsed = parseIndexScan(json);
    // Empty is an error rather than an empty board, so the cache keeps the last good list.
    if (parsed.length === 0) throw new Error("the scan listed no ASX 200 members");
    return parsed;
  }

  /**
   * The scan's ASX 200 members (with `asOf` set when an older list stood in
   * for a failed scan), or the reason it failed.
   */
  async function scanMembers(force: boolean): Promise<{ list: Constituent[]; asOf: number | null } | string> {
    if (!force && scanFailedAt && now() - scanFailedAt.at < SCAN_RETRY_MS) {
      const kept = members.peek("XJO");
      return kept ? { list: kept.data, asOf: kept.fetchedAt } : scanFailedAt.reason;
    }
    try {
      // A failed scan falls back to the last list for up to a fortnight; past that it is an error.
      const result = await members.load("XJO", scan);
      if (result.source === "stale-fallback") {
        // The back-off applies to a failed scan with a list to fall back on, too.
        scanFailedAt = { at: now(), reason: result.refreshError ?? "request failed" };
        return { list: result.data, asOf: result.fetchedAt };
      }
      scanFailedAt = null;
      return { list: result.data, asOf: null };
    } catch (error) {
      scanFailedAt = { at: now(), reason: scanFailure(error) };
      return scanFailedAt.reason;
    }
  }

  /**
   * The directory, with market caps the directory leaves blank (it has none
   * for CBA) filled from quotes, so the ranking does not skip the largest
   * bank. Kept for twelve hours once every fill quote came back; a fill with
   * gaps is kept for ten minutes, so a refusal is neither stuck for half a day
   * nor asked again on every board load.
   */
  async function rankedListings(provider: DataProvider, listings: readonly Listing[]): Promise<Listing[]> {
    if (ranking && now() - ranking.at < ranking.ttl) return ranking.listings;
    const blanks = listings.filter((listing) => listing.marketCap == null && sectorForIndustryGroup(listing.industryGroup));
    const fill = await fetchQuotes(provider, blanks.map((listing) => companyTarget(listing.code)));
    const filled = listings.map((listing) => {
      if (listing.marketCap != null) return listing;
      const cap = fill.quotes.get(axSymbol(listing.code))?.marketCap ?? null;
      return cap ? { ...listing, marketCap: cap } : listing;
    });
    ranking = { at: now(), ttl: fill.failed === 0 ? 12 * HOUR : SCAN_RETRY_MS, listings: filled };
    return filled;
  }

  async function constituents(provider: DataProvider, universe: "asx50" | "asx200", source: ConstituentSource, listings: Listing[] | null, force: boolean) {
    let fallback: string | null = null;
    if (source === "tradingview") {
      const scanned = await scanMembers(force);
      if (typeof scanned !== "string") {
        const list = universe === "asx50" ? scanned.list.filter((member) => member.inAsx50) : scanned.list;
        // A scan that stops tagging the ASX 50 (or lists a fraction of the 200) is not the index.
        if (list.length >= MIN_MEMBERS[universe]) return { members: list, ranked: false, fallback, membersAsOf: scanned.asOf };
        fallback = `the scan listed only ${list.length} ${universe === "asx50" ? "ASX 50" : "ASX 200"} members`;
      } else {
        fallback = scanned;
      }
    }
    if (!listings) throw new Error("The ASX company directory is unavailable");
    const ranked = rankByMarketCap(await rankedListings(provider, listings), UNIVERSE_SIZE[universe]);
    return { members: ranked, ranked: true, fallback, membersAsOf: null };
  }

  async function build(provider: DataProvider, { universe, source, force = false }: HeatmapLoadOptions): Promise<HeatmapBoard> {
    const listings = await directory().catch(() => null);
    const byCode = new Map((listings ?? []).map((listing) => [listing.code, listing]));
    // Sector weights need the directory's sectors; without it the sector indices are sized evenly.
    const { members: list, ranked, fallback, membersAsOf } = universe === "sectors" && !listings
      ? { members: [], ranked: false, fallback: null, membersAsOf: null }
      : await constituents(provider, universe === "sectors" ? "asx200" : universe, source, listings, force);
    const targets = universe === "sectors"
      ? SECTOR_INDICES.map((index): QuoteSubscriptionTarget => ({ symbol: index.symbol, exchange: "", surface: "monitor" }))
      : list.map((member) => companyTarget(member.code));
    const fetched = await fetchQuotes(provider, targets, force);
    if (fetched.quotes.size === 0) {
      throw new Error(fetched.rateLimited
        ? "Gloom Cloud's limit for signed-out use was reached. Try again in a minute, or sign in."
        : `No quotes for the heatmap${fetched.error ? `: ${fetched.error}` : ""}`);
    }
    const assets = universe === "sectors"
      // Sector areas follow the market cap of each sector's members, with directory sectors.
      ? sectorIndexAssets(fetched.quotes, listings ? list.map((member) => ({ ...member, industryGroup: byCode.get(member.code)?.industryGroup ?? null, marketCap: byCode.get(member.code)?.marketCap ?? member.marketCap })) : null)
      : list.flatMap((member) => {
        const asset = companyAsset(member, byCode.get(member.code), fetched.quotes.get(axSymbol(member.code)));
        return asset ? [asset] : [];
      }).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    const times = assets.map((asset) => asset.lastUpdated).filter((time): time is number => time != null);
    return {
      universe,
      assets,
      ranked,
      fallback,
      missingQuotes: fetched.failed,
      rateLimited: fetched.rateLimited,
      sectorsUnavailable: listings === null,
      membersAsOf,
      asOf: times.length ? Math.max(...times) : null,
      builtAt: now(),
      refreshError: null,
    };
  }

  return {
    /**
     * `force` refetches quotes and retries a failed scan at once; membership
     * keeps its daily cache. A failed refresh returns the last board, up to
     * ten minutes old, with `refreshError` set, so the pane says so.
     */
    async load(provider: DataProvider, options: HeatmapLoadOptions): Promise<HeatmapBoard> {
      const key = `${options.universe}:${options.source}`;
      try {
        return await boards.load(key, () => build(provider, options), options.force);
      } catch (error) {
        const last = boards.peek(key);
        if (!last || now() - last.builtAt >= KEEP_BOARD_MS) throw error;
        return { ...last, refreshError: error instanceof Error && error.message ? error.message : "request failed" };
      }
    },
  };
}

const defaultLoader = createHeatmapLoader();

export function loadHeatmap(provider: DataProvider, options: HeatmapLoadOptions): Promise<HeatmapBoard> {
  return defaultLoader.load(provider, options);
}
