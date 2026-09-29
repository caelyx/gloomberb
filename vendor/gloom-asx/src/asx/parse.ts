import type { AnnouncementsPage, AsxAnnouncement, EntityMatch } from "./model";
import { normaliseAsxCode, pdfUrl } from "./urls";

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function dataOf(json: unknown): Raw | null {
  if (!isRecord(json)) return null;
  return isRecord(json.data) ? json.data : json;
}

function itemsOf(json: unknown): unknown[] {
  const data = dataOf(json);
  return data && Array.isArray(data.items) ? data.items : [];
}

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function firstString(record: Raw, keys: string[]): string {
  for (const key of keys) {
    const value = str(record[key]);
    if (value) return value;
  }
  return "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function firstNumber(record: Raw, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(record[key]);
    if (value !== null) return value;
  }
  return null;
}

const SIZE_UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024 };

/** The live feed sends sizes as strings such as "257KB"; plain numbers are taken as bytes. */
function byteSize(value: unknown): number | null {
  const plain = num(value);
  if (plain !== null) return plain;
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB)$/i.exec(value.trim());
  return match ? Math.round(Number(match[1]) * SIZE_UNITS[match[2]!.toUpperCase()]!) : null;
}

function firstByteSize(record: Raw, keys: string[]): number | null {
  for (const key of keys) {
    const value = byteSize(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(y|yes|true|1)$/i.test(value.trim());
  if (typeof value === "number") return value !== 0;
  return false;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstDate(record: Raw, keys: string[]): string {
  for (const key of keys) {
    const value = isoDate(record[key]);
    if (value) return value;
  }
  return "";
}

function labels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (isRecord(entry) ? firstString(entry, ["name", "label", "description", "type"]) : str(entry)))
    .filter(Boolean);
}

/**
 * The issuer that lodged the document. `companyInfo` lists the lodging
 * company, which is not always the one queried: an entity's feed also carries
 * other issuers' notices that name it (a substantial-holder notice lodged by
 * CAR Group appears in CBA's feed with `symbol: "CAR"`).
 */
function companyName(record: Raw, symbol: string): string | null {
  const info = Array.isArray(record.companyInfo) ? record.companyInfo.filter(isRecord) : [];
  const own = info.find((entry) => normaliseAsxCode(str(entry.symbol)) === symbol) ?? info[0];
  if (own) {
    const name = firstString(own, ["displayName", "name", "companyName"]);
    if (name) return name;
  }
  return firstString(record, ["companyName", "issuerName", "displayName", "entityName"]) || null;
}

export function parsePredictiveSearch(json: unknown): EntityMatch[] {
  const matches: EntityMatch[] = [];
  for (const raw of itemsOf(json)) {
    if (!isRecord(raw)) continue;
    const xid = firstString(raw, ["xidEntity", "entityXid", "xid"]);
    if (!xid) continue;
    matches.push({
      xid,
      symbol: normaliseAsxCode(firstString(raw, ["symbol", "code", "ticker"])),
      displayName: firstString(raw, ["displayName", "name", "companyName"]) || null,
    });
  }
  return matches;
}

/** Exact symbol match wins; the first result is trusted only when the API named no symbols at all. */
export function pickEntityForCode(matches: EntityMatch[], code: string): EntityMatch | null {
  const wanted = normaliseAsxCode(code);
  const exact = matches.find((match) => match.symbol === wanted);
  if (exact) return exact;
  if (matches.length > 0 && matches.every((match) => !match.symbol)) return matches[0] ?? null;
  return null;
}

export interface ParsePageOptions {
  page: number;
  itemsPerPage: number;
  accessToken?: string | null;
}

export function parseAnnouncement(raw: unknown, accessToken?: string | null): AsxAnnouncement | null {
  if (!isRecord(raw)) return null;
  const documentKey = firstString(raw, ["documentKey", "document_key"]);
  const headline = firstString(raw, ["headline", "header", "title"]);
  if (!documentKey || !headline) return null;
  const sensitive = raw.isPriceSensitive ?? raw.marketSensitive ?? raw.market_sensitive ?? raw.priceSensitive;
  const symbol = normaliseAsxCode(firstString(raw, ["symbol", "code", "ticker"]));
  return {
    documentKey,
    symbol,
    companyName: companyName(raw, symbol),
    headline,
    releasedAt: firstDate(raw, ["date", "releasedAt", "documentReleaseDate", "document_release_date", "documentDate"]),
    isPriceSensitive: bool(sensitive),
    types: labels(raw.announcementTypes ?? raw.types ?? raw.documentTypes),
    pageCount: firstNumber(raw, ["numberOfPages", "pageCount", "pages", "number_of_pages"]),
    fileSizeBytes: firstByteSize(raw, ["fileSize", "size", "fileSizeBytes", "sizeBytes"]),
    pdfUrl: firstString(raw, ["url", "documentUrl"]) || pdfUrl(documentKey, accessToken),
  };
}

export function parseAnnouncementsPage(json: unknown, options: ParsePageOptions): AnnouncementsPage {
  const items = itemsOf(json)
    .map((raw) => parseAnnouncement(raw, options.accessToken))
    .filter((item): item is AsxAnnouncement => item !== null)
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
  const data = dataOf(json);
  const totalItems = data ? firstNumber(data, ["totalItems", "total", "count", "totalCount", "itemCount"]) : null;
  // The live feed's `count` is the entity's total, not the page's. An empty page ends paging even when the
  // total says otherwise, so a stale total cannot make scrolling request empty pages forever.
  const hasMore = items.length > 0 && (totalItems !== null
    ? (options.page + 1) * options.itemsPerPage < totalItems
    : items.length >= options.itemsPerPage);
  return { items, page: options.page, itemsPerPage: options.itemsPerPage, hasMore, totalItems };
}
