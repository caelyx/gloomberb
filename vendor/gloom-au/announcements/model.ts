import { decodeHtmlEntities, zonedWallClockToUtcMs } from "gloomberb/utils";
import { ASX_TIME_ZONE } from "../shared/asx";

export const ASX_ORIGIN = "https://www.asx.com.au";

export type AnnouncementCategory =
  | "halt"
  | "query"
  | "results"
  | "directors"
  | "substantial"
  | "takeover"
  | "dividend"
  | "capital"
  | "meeting"
  | "other";

export const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  halt: "Trading halts",
  query: "ASX queries",
  results: "Results",
  directors: "Director interests",
  substantial: "Substantial holders",
  takeover: "Takeovers",
  dividend: "Dividends",
  capital: "Capital",
  meeting: "Meetings",
  other: "Other",
};

export const CATEGORY_SHORT: Record<AnnouncementCategory, string> = {
  halt: "Halt",
  query: "ASX query",
  results: "Results",
  directors: "Director",
  substantial: "Substantial",
  takeover: "Takeover",
  dividend: "Dividend",
  capital: "Capital",
  meeting: "Meeting",
  other: "",
};

export interface AsxAnnouncement {
  /** Stable across reloads: the document id, or code + time + headline. */
  id: string;
  /** The issuer that lodged it. A company's feed also carries other issuers' notices that name it. */
  code: string;
  /** The lodging issuer's name, when the source gives it. */
  companyName: string | null;
  /** Markit's key for the PDF, when the source gives it. */
  documentKey: string | null;
  releasedAt: number;
  headline: string;
  priceSensitive: boolean;
  category: AnnouncementCategory;
  /** ASX's own type labels when the source carries them (market feed). */
  types: string[];
  pages: number | null;
  /** As ASX prints it, e.g. "374.6KB". */
  size: string | null;
  /** The ASX document page (terms, then the PDF). Null when the source has no usable link. */
  documentUrl: string | null;
}

/*
 * Ordered: the first matching rule wins. ASX headlines and types for these
 * notices are standardised by the listing rules (Appendix 3X/3Y/3Z, Forms
 * 603/604/605, Appendix 4C/4D/4E), so headline matching is reliable for them.
 */
const CATEGORY_RULES: ReadonlyArray<[AnnouncementCategory, RegExp, "headline"?]> = [
  ["halt", /trading halt|suspension from (official )?quotation|voluntary suspension|reinstatement to (official )?quotation/i],
  ["query", /(price|aware|asx) query|response to asx/i],
  // A register report, not a payout: "Top 20 Holders and Distribution Schedule". Headline only:
  // ASX also tags annual reports "Top 20 shareholders", and those are results.
  ["other", /top (20|twenty)\b|distribution schedule/i, "headline"],
  ["directors", /director'?s'? interest|appendix 3[xyz]\b|final director/i],
  ["substantial", /substantial (holder|holding|shareholder)|form 60[345]\b/i],
  ["takeover", /takeover|bidder'?s statement|target'?s statement|scheme (of arrangement|booklet|meeting|implement)|off-market bid|compulsory acquisition/i],
  // Before `results`: "Results of Meeting" is a meeting outcome, not earnings.
  ["meeting", /results? of (the )?(annual |extraordinary )?(general )?meeting/i],
  ["results", /appendix 4[cde]\b|half[- ]?year|full[- ]?year|annual report|annual financial report|preliminary final|quarterly (activit|cash|report|update)|\bresults?\b|investor presentation|earnings/i],
  ["dividend", /dividend|distribution|\bdrp\b/i],
  ["capital", /appendix (2a|3[bcefgh])\b|buy-?back|issue of securities|issued capital|cleansing|placement|capital raising|share purchase plan|entitlement|cessation of securities|quotation of securities|capital reconstruction|disclosure document|prospectus|renounceable|rights issue|option offer|\bs708a?\b/i],
  ["meeting", /general meeting|\bagm\b|proxy form|results of meeting|letter to (share|security|unit)holders|chair(man)?'?s address/i],
];

export function classifyAnnouncement(headline: string, types: readonly string[] = []): AnnouncementCategory {
  const text = [...types, headline].join(" | ");
  for (const [category, pattern, scope] of CATEGORY_RULES) {
    if (pattern.test(scope === "headline" ? headline : text)) return category;
  }
  return "other";
}

/** `dd/mm/yyyy` and `h:mm am` in Sydney time to UTC ms. */
export function parseAsxDateTime(date: string, time: string): number | null {
  const day = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!day) return null;
  const clock = time.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  let hour = 0;
  let minute = 0;
  if (clock) {
    hour = Number(clock[1]) % 12 + (clock[3]!.toLowerCase() === "p" ? 12 : 0);
    minute = Number(clock[2]);
  }
  const ms = zonedWallClockToUtcMs(ASX_TIME_ZONE, Number(day[3]), Number(day[2]), Number(day[1]), hour, minute, 0);
  return Number.isFinite(ms) ? ms : null;
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export class UnknownAsxCodeError extends Error {
  constructor(code: string) {
    super(`ASX has no company with the code ${code}.`);
    this.name = "UnknownAsxCodeError";
  }
}

/**
 * The company announcements page (`/asx/v2/statistics/announcements.do`).
 * The `<announcement_data>` block marks a readable list, which may be empty;
 * without it the code is unknown or the page changed shape, and neither may
 * render as "no announcements".
 */
export function parseCompanyAnnouncementsHtml(html: string, code: string): AsxAnnouncement[] {
  const block = html.match(/<announcement_data>([\s\S]*?)<\/announcement_data>/i);
  if (!block) {
    if (/does not match any compan/i.test(html)) throw new UnknownAsxCodeError(code);
    throw new Error("ASX announcements page format was not recognised");
  }
  const rows = block[1]!.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  const announcements: AsxAnnouncement[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 3) continue; // the header row uses <th>
    const date = cells[0]!.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1];
    const time = cells[0]!.match(/dates-time">\s*([^<]+?)\s*</i)?.[1] ?? "";
    const releasedAt = date ? parseAsxDateTime(date, time) : null;
    const link = cells[2]!.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (releasedAt == null || !link) continue;
    const href = decodeHtmlEntities(link[1]!);
    const headline = stripTags(link[2]!.split(/<br\s*\/?>/i)[0] ?? "");
    if (!headline) continue;
    const idsId = href.match(/idsId=(\d+)/)?.[1] ?? null;
    const pages = Number(cells[2]!.match(/class="page">\s*(\d+)/i)?.[1]);
    const size = cells[2]!.match(/class="filesize">\s*([^<]+?)\s*</i)?.[1] ?? null;
    announcements.push({
      id: idsId ? `ids:${idsId}` : `${code}:${releasedAt}:${headline}`,
      code,
      companyName: null,
      documentKey: null,
      releasedAt,
      headline,
      priceSensitive: /icon-price-sensitive|title="price sensitive"/i.test(cells[1]!),
      category: classifyAnnouncement(headline),
      types: [],
      pages: Number.isFinite(pages) && pages > 0 ? pages : null,
      size,
      documentUrl: href.startsWith("http") ? href : `${ASX_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`,
    });
  }
  return announcements.sort((a, b) => b.releasedAt - a.releasedAt);
}

interface MarketFeedItem {
  announcementTypes?: unknown;
  companyInfo?: unknown;
  date?: unknown;
  documentKey?: unknown;
  fileSize?: unknown;
  headline?: unknown;
  isPriceSensitive?: unknown;
  symbol?: unknown;
}

/**
 * The lodging issuer's name. `companyInfo` lists the lodging company, which
 * is not always the one asked about: a company's feed also carries other
 * issuers' notices that name it (a substantial-holder notice lodged by CAR
 * Group appears in CBA's feed under CAR).
 */
function lodgingCompanyName(raw: MarketFeedItem, code: string): string | null {
  const info = Array.isArray(raw.companyInfo) ? raw.companyInfo as Array<Record<string, unknown>> : [];
  const own = info.find((entry) => typeof entry?.symbol === "string" && entry.symbol.trim().toUpperCase() === code) ?? info[0];
  const name = typeof own?.displayName === "string" ? own.displayName.trim() : "";
  return name || null;
}

/** The PDF behind a market-feed document key, served without a token (as asx.com.au fetches it). */
export function announcementPdfUrl(documentKey: string): string {
  return `https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/${encodeURIComponent(documentKey)}`;
}

/**
 * The market-wide feed (Markit, as used by asx.com.au). Its document keys
 * open the PDF on Markit's file host; they are not the ids the asx.com.au
 * document page takes.
 */
export function parseMarketAnnouncementsJson(payload: unknown): AsxAnnouncement[] {
  const items = (payload as { data?: { items?: unknown } } | null)?.data?.items;
  if (!Array.isArray(items)) throw new Error("ASX market announcements format was not recognised");
  const announcements: AsxAnnouncement[] = [];
  for (const raw of items as MarketFeedItem[]) {
    const code = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
    const releasedAt = typeof raw.date === "string" ? Date.parse(raw.date) : Number.NaN;
    const headline = typeof raw.headline === "string" ? decodeHtmlEntities(raw.headline).trim() : "";
    if (!code || !Number.isFinite(releasedAt) || !headline) continue;
    const types = Array.isArray(raw.announcementTypes)
      ? raw.announcementTypes.filter((type): type is string => typeof type === "string" && type.trim() !== "")
      : [];
    const documentKey = typeof raw.documentKey === "string" && raw.documentKey ? raw.documentKey : null;
    const key = documentKey ?? `${code}:${releasedAt}:${headline}`;
    announcements.push({
      id: `mkt:${key}`,
      code,
      companyName: lodgingCompanyName(raw, code),
      documentKey,
      releasedAt,
      headline,
      priceSensitive: raw.isPriceSensitive === true,
      category: classifyAnnouncement(headline, types),
      types,
      pages: null,
      size: typeof raw.fileSize === "string" && raw.fileSize ? raw.fileSize : null,
      documentUrl: documentKey ? announcementPdfUrl(documentKey) : null,
    });
  }
  if (announcements.length === 0 && items.length > 0) {
    throw new Error("ASX market announcements format was not recognised");
  }
  return announcements.sort((a, b) => b.releasedAt - a.releasedAt);
}

export type AnnouncementFilter = "all" | "sensitive" | AnnouncementCategory;

export function filterAnnouncements(
  rows: readonly AsxAnnouncement[],
  filter: AnnouncementFilter,
  priceSensitiveOnly = false,
): AsxAnnouncement[] {
  return rows.filter((row) => (!priceSensitiveOnly || row.priceSensitive)
    && (filter === "all" || (filter === "sensitive" ? row.priceSensitive : row.category === filter)));
}

/** The ASX page listing one company's announcements over the last six months. */
export function companyAnnouncementsPageUrl(code: string): string {
  return `${ASX_ORIGIN}/asx/v2/statistics/announcements.do?by=asxCode&asxCode=${encodeURIComponent(code)}&timeframe=D&period=M6`;
}

/** "M6" for the last six months, or a calendar year. */
export type AnnouncementPeriod = "M6" | `${number}`;

export function companyAnnouncementsUrl(code: string, period: AnnouncementPeriod): string {
  const search = new URLSearchParams({ by: "asxCode", asxCode: code });
  if (period === "M6") {
    search.set("timeframe", "D");
    search.set("period", "M6");
  } else {
    search.set("timeframe", "Y");
    search.set("year", period);
  }
  return `${ASX_ORIGIN}/asx/v2/statistics/announcements.do?${search}`;
}
