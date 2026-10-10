import type { PluginPersistence } from "gloomberb/types/plugin";
import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectNumber, expectString, nullableNumber, type Cached, type DiskCodec } from "../shared/disk-cache";
import { fetchBytes, fetchJson } from "../shared/http";
import { announcementsCodec } from "./client";
import { cleanPdfText, extractSummary } from "./extract/clean";
import { toExtractUnavailable } from "./extract/errors";
import { extractPdfText } from "./extract/pdf-text";
import { FEED_PAGE_SIZE, entityFeedUrl, parseFeedPage, pickEntity, predictiveSearchUrl, type EntityMatch, type FeedPage } from "./feed";
import { announcementPdfUrl, type AsxAnnouncement } from "./model";

export interface AnnouncementExtract {
  /** Cleaned, length-limited text from the first pages of the PDF. */
  text: string;
  totalPages: number;
  pagesRead: number;
}

/** Stored as parsed; the page's rows are checked as the market feed's are. */
export const feedPageCodec: DiskCodec<FeedPage, FeedPage> = {
  encode: (page) => page,
  decode: (stored) => {
    if (!stored || typeof stored !== "object" || typeof stored.hasMore !== "boolean") throw new Error("Cached announcement page is not recognised");
    return {
      items: announcementsCodec.decode(stored.items),
      page: expectNumber(stored.page, "page number"),
      hasMore: stored.hasMore,
      totalItems: nullableNumber(stored.totalItems, "announcement count"),
    };
  },
};

export const extractCodec: DiskCodec<AnnouncementExtract, AnnouncementExtract> = {
  encode: (extract) => extract,
  decode: (stored) => {
    if (!stored || typeof stored !== "object") throw new Error("Cached extract is not recognised");
    return {
      text: expectString(stored.text, "extract text"),
      totalPages: expectNumber(stored.totalPages, "page count"),
      pagesRead: expectNumber(stored.pagesRead, "pages read"),
    };
  },
};

/** A list can gain a row at any moment in market hours. */
const pages = createDiskCache(CACHE_POLICY.feedPage, feedPageCodec);
/** A published PDF does not change. */
const extracts = createDiskCache(CACHE_POLICY.extract, extractCodec);

let persistence: PluginPersistence | null = null;
let accessToken: string | null = null;
const entityMemory = new Map<string, EntityMatch>();
const entityInflight = new Map<string, Promise<EntityMatch>>();

export class UnknownEntityError extends Error {
  constructor(readonly code: string) {
    super(`ASX search has no company with the code ${code}.`);
    this.name = "UnknownEntityError";
  }
}

/** The entity lookups live in plain plugin state; the feed and extract caches attach with the rest (`attachDiskCaches`). */
export function attachCompanyFeed(next: PluginPersistence): void {
  persistence = next;
}

/**
 * Only for a file host that starts refusing anonymous downloads: the
 * site-wide token the asx.com.au front end embeds. Empty by default.
 */
export function setAnnouncementAccessToken(token: string | null | undefined): void {
  accessToken = token?.trim() || null;
}

/** The PDF link, with the optional token. */
export function announcementDocumentUrl(documentKey: string): string {
  const url = announcementPdfUrl(documentKey);
  return accessToken ? `${url}?access_token=${encodeURIComponent(accessToken)}` : url;
}

/** The entity for a code never changes, so it is kept as plain state rather than a TTL resource. */
async function resolveEntity(code: string): Promise<EntityMatch> {
  const remembered = entityMemory.get(code)
    ?? persistence?.getState<EntityMatch>(`entity:${code}`, { schemaVersion: 1 })
    ?? null;
  if (remembered) {
    entityMemory.set(code, remembered);
    return remembered;
  }
  let pending = entityInflight.get(code);
  if (!pending) {
    pending = fetchJson<unknown>(predictiveSearchUrl(code)).then((payload) => {
      const entity = pickEntity(payload, code);
      if (!entity) throw new UnknownEntityError(code);
      entityMemory.set(code, entity);
      persistence?.setState(`entity:${code}`, entity, { schemaVersion: 1 });
      return entity;
    }).finally(() => entityInflight.delete(code));
    entityInflight.set(code, pending);
  }
  return pending;
}

/** One page of a company's announcements, newest first; cache-first, so a refresh within 15 minutes costs nothing. */
export function loadFeedPage(code: string, page: number, options: { force?: boolean } = {}): Promise<Cached<FeedPage>> {
  const normalized = code.trim().toUpperCase();
  return pages.load(`${normalized}:${page}:${FEED_PAGE_SIZE}`, async () => {
    const entity = await resolveEntity(normalized);
    const parsed = parseFeedPage(await fetchJson<unknown>(entityFeedUrl(entity.xid, page)), page);
    return { ...parsed, items: parsed.items.map(withDocumentUrl) };
  }, { force: options.force });
}

/** The cached first page, even if stale, so a pane opens with yesterday's list while it refreshes. */
export function cachedFirstPage(code: string): FeedPage | null {
  return pages.peek(`${code.trim().toUpperCase()}:0:${FEED_PAGE_SIZE}`)?.data ?? null;
}

function withDocumentUrl(item: AsxAnnouncement): AsxAnnouncement {
  return item.documentKey ? { ...item, documentUrl: announcementDocumentUrl(item.documentKey) } : item;
}

/**
 * The first pages of an announcement's PDF as text. An enhancement only: any
 * failure rejects with an `ExtractUnavailableError` whose message stands in
 * for the extract, and nothing is cached, so the row and its PDF stay usable.
 */
export function loadExtract(item: AsxAnnouncement, options: { maxPages?: number; maxChars?: number } = {}): Promise<Cached<AnnouncementExtract>> {
  const key = item.documentKey;
  if (!key) return Promise.reject(toExtractUnavailable(new Error("No document key")));
  return extracts.load(key, async () => {
    try {
      const bytes = await fetchBytes(announcementDocumentUrl(key), "application/pdf, */*");
      const { text, totalPages, pagesRead } = await extractPdfText(bytes, { maxPages: options.maxPages ?? 2 });
      return { text: extractSummary(cleanPdfText(text), { maxChars: options.maxChars ?? 2_000 }), totalPages, pagesRead };
    } catch (error) {
      throw toExtractUnavailable(error);
    }
  });
}
