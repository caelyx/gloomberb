import { parseMarketAnnouncementsJson, type AsxAnnouncement } from "./model";

const API = "https://asx.api.markitdigital.com/asx-research/1.0";

/** Fifty is the most the feed serves per page, and what asx.com.au asks for. */
export const FEED_PAGE_SIZE = 50;

export interface EntityMatch {
  /** Markit's entity id; announcements filter on it. */
  xid: string;
  symbol: string;
  displayName: string | null;
}

export interface FeedPage {
  items: AsxAnnouncement[];
  page: number;
  hasMore: boolean;
  /** The entity's total announcement count, when the feed reports it. */
  totalItems: number | null;
}

/** Resolves an ASX code to the entity whose announcements the feed filters on. */
export function predictiveSearchUrl(code: string): string {
  return `${API}/search/predictive?${new URLSearchParams({ searchText: code })}`;
}

/** The entity's announcements, newest first. Literal brackets, as asx.com.au sends them. */
export function entityFeedUrl(xid: string, page: number, itemsPerPage = FEED_PAGE_SIZE): string {
  return `${API}/markets/announcements?entityXids[]=${encodeURIComponent(xid)}&page=${page}&itemsPerPage=${itemsPerPage}`;
}

/**
 * The entity for a code. Only an exact symbol match counts: the search also
 * returns similarly named companies. An ETF resolves to its issuer, whose
 * feed then carries the issuer's other funds too.
 */
export function pickEntity(payload: unknown, code: string): EntityMatch | null {
  const items = (payload as { data?: { items?: unknown } } | null)?.data?.items;
  if (!Array.isArray(items)) return null;
  const wanted = code.trim().toUpperCase();
  for (const raw of items as Array<Record<string, unknown>>) {
    const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
    const xid = typeof raw.xidEntity === "string" || typeof raw.xidEntity === "number" ? String(raw.xidEntity) : "";
    if (symbol === wanted && xid) {
      return { xid, symbol, displayName: typeof raw.displayName === "string" ? raw.displayName.trim() || null : null };
    }
  }
  return null;
}

/**
 * One page of an entity's feed. Its `count` is the entity's total, not the
 * page's. An empty page ends paging even when the total says otherwise, so a
 * stale total never makes scrolling request empty pages forever.
 */
export function parseFeedPage(payload: unknown, page: number, itemsPerPage = FEED_PAGE_SIZE): FeedPage {
  const items = parseMarketAnnouncementsJson(payload);
  const count = (payload as { data?: { count?: unknown } }).data?.count;
  const totalItems = typeof count === "number" && Number.isFinite(count) ? count : null;
  const hasMore = items.length > 0 && (totalItems !== null ? (page + 1) * itemsPerPage < totalItems : items.length >= itemsPerPage);
  return { items, page, hasMore, totalItems };
}
