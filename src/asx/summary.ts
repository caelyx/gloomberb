import type { AsxAnnouncement } from "./model";

export type AnnouncementKind =
  | "trading-halt" | "substantial-holder" | "director-interest" | "quarterly" | "results" | "dividend"
  | "buy-back" | "capital" | "agm" | "presentation" | "asx-query" | "other";

export interface AnnouncementClass {
  kind: AnnouncementKind;
  label: string;
}

/** Ordered: the first pattern that matches the headline wins. */
const RULES: Array<[AnnouncementKind, string, RegExp]> = [
  ["trading-halt", "Trading halt", /trading halt|suspension from (official )?quotation|voluntary suspension|reinstatement to (official )?quotation/i],
  ["asx-query", "ASX query", /(price|aware|asx) query|response to asx/i],
  ["substantial-holder", "Substantial holder", /substantial hold(er|ing)/i],
  ["director-interest", "Director interest", /appendix 3[xyz]\b|director['’]?s?['’]? interest/i],
  ["buy-back", "Buy-back", /buy-?back|appendix 3[cdef]\b/i],
  ["agm", "AGM", /annual general meeting|\bagm\b|results of meeting|notice of (general )?meeting|proxy form/i],
  ["quarterly", "Quarterly", /appendix 4c\b|quarterly (activities|cash ?flow|report|update)/i],
  ["results", "Results", /appendix 4[de]\b|results|annual report|half[- ]?year|full[- ]?year|preliminary final|financial report|interim report/i],
  ["dividend", "Dividend", /dividend|distribution/i],
  ["capital", "Capital", /appendix (2a|3b)\b|proposed issue|application for quotation|cleansing|placement|capital raising|entitlement offer|share purchase plan|prospectus|rights issue/i],
  ["presentation", "Presentation", /presentation|webcast|briefing/i],
];

export function classifyAnnouncement(headline: string, types: readonly string[] = []): AnnouncementClass {
  const haystack = `${headline} ${types.join(" ")}`;
  for (const [kind, label, pattern] of RULES) {
    if (pattern.test(haystack)) return { kind, label };
  }
  const typeLabel = types.find((type) => type.trim().length > 0)?.trim();
  return { kind: "other", label: typeLabel ?? "Announcement" };
}

const WATERMARK = /for\s*personal\s*use\s*only/gi;
const PAGE_MARKER = /^(page\s+)?\d+(\s+of\s+\d+)?$/i;
const ENDS_SENTENCE = /[.!?:]["')\]]?$/;

/** `extractPdfText` separates pages with a form feed so page furniture can be recognised. */
export const PAGE_BREAK = "\f";
const HEADER_ZONE = 300;
const MIN_HEADER_WORDS = 3;
const MIN_HEADER_CHARS = 15;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function withoutLeadingWords(page: string, words: readonly string[]): string {
  return page.replace(new RegExp(`^\\s*${words.map(escapeRegExp).join("\\s+")}`), "");
}

/**
 * Removes running headers and "n / m" page counters. Form-style PDFs such as
 * Appendix 3A.1 print "Appendix 3A.1 - Notification of dividend / distribution"
 * twice at the top of every page, followed by "1 / 7", "2 / 7" and so on.
 */
function stripPageFurniture(pages: string[]): string[] {
  const cleaned = pages.map((page, index) => {
    // Only the page's own number, near its top, so "50 / 50" in the body survives.
    const counter = new RegExp(`(^|\\s)${index + 1}\\s*/\\s*\\d+(?=\\s|$)`);
    const head = page.slice(0, HEADER_ZONE).replace(counter, "$1");
    // A heading printed twice in a row: keep one copy.
    return (head + page.slice(HEADER_ZONE)).replace(/^\s*(\S.{14,199}?)\s+\1(?=\s|$)/s, "$1");
  });
  const firstWords = cleaned[0]?.trim().split(/\s+/) ?? [];
  return cleaned.map((page, index) => {
    if (index === 0) return page;
    const words = page.trim().split(/\s+/);
    let shared = 0;
    while (shared < firstWords.length && shared < words.length && firstWords[shared] === words[shared]) shared += 1;
    const header = firstWords.slice(0, shared);
    return shared >= MIN_HEADER_WORDS && header.join(" ").length >= MIN_HEADER_CHARS ? withoutLeadingWords(page, header) : page;
  });
}

/** Strips the ASX watermark and layout noise, and rebuilds paragraphs from PDF lines. */
export function cleanPdfText(raw: string): string {
  const pages = stripPageFurniture(raw.replace(WATERMARK, "").split(PAGE_BREAK));
  const lines = pages.join("\n").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
  };
  for (const line of lines) {
    if (!line) { flush(); continue; }
    if (PAGE_MARKER.test(line)) continue;
    current.push(line);
    if (ENDS_SENTENCE.test(line)) flush();
  }
  flush();
  return paragraphs.join("\n").trim();
}

const SENTENCE_END = /[.!?]["')\]]?(?=\s|$)/g;

/** The first whole sentences that fit; a lone run-on sentence is hard-cut. */
export function extractSummary(text: string, { maxChars = 1500 }: { maxChars?: number } = {}): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const budget = maxChars - 2; // room for " …"
  let cut = 0;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (end > budget) break;
    cut = end;
  }
  if (cut === 0) return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
  return `${trimmed.slice(0, cut).trimEnd()} …`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SYDNEY = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney", year: "numeric", month: "numeric", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
});

/** "29 Sep 2026 10:05 AEST". Announcements are stamped in Sydney time on the ASX site. */
export function formatSydneyTime(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(SYDNEY.formatToParts(date).map((part) => [part.type, part.value]));
  const month = MONTHS[Number(parts.month) - 1] ?? parts.month;
  const zone = /\+11/.test(parts.timeZoneName ?? "") ? "AEDT" : /\+10/.test(parts.timeZoneName ?? "") ? "AEST" : parts.timeZoneName ?? "";
  return `${parts.day} ${month} ${parts.year} ${parts.hour}:${parts.minute} ${zone}`.trim();
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Whether another issuer lodged this announcement; an entity's feed carries notices that merely name it. */
export function isOtherIssuer(announcement: AsxAnnouncement, code: string): boolean {
  return announcement.symbol !== "" && announcement.symbol !== code;
}

/** The metadata lines shown under an announcement's headline, for the pane showing `code`. */
export function describeAnnouncement(announcement: AsxAnnouncement, { code }: { code?: string } = {}): string[] {
  const lines: string[] = [];
  if (code && isOtherIssuer(announcement, code)) {
    lines.push(`Lodged by ${announcement.companyName ?? announcement.symbol} (ASX:${announcement.symbol})`);
  } else if (announcement.companyName) {
    lines.push(announcement.companyName);
  }
  lines.push(classifyAnnouncement(announcement.headline, announcement.types).label);
  lines.push(announcement.isPriceSensitive ? "Price sensitive" : "Not price sensitive");
  if (announcement.releasedAt) lines.push(`Released ${formatSydneyTime(announcement.releasedAt)}`);
  const size: string[] = [];
  if (announcement.pageCount !== null) size.push(`${announcement.pageCount} ${announcement.pageCount === 1 ? "page" : "pages"}`);
  // The feed's size is rounded and does not match the file it serves, so say so.
  if (announcement.fileSizeBytes !== null) size.push(`~${formatFileSize(announcement.fileSizeBytes)}`);
  if (size.length > 0) lines.push(size.join(", "));
  return lines;
}
