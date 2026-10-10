import type { DataTableColumn, FeedDataTableItem, StackSortPreference, StatItem } from "gloomberb/components";
import { displayWidth, zonedDateTimeParts } from "gloomberb/utils";
import { ASX_TIME_ZONE } from "../shared/asx";
import { formatReleased } from "../shared/time";
import { CATEGORY_SHORT, type AsxAnnouncement } from "./model";

export type ExtractState =
  | { status: "loading" }
  | { status: "ready"; text: string; totalPages: number; pagesRead: number }
  /** `message` is shown as is in place of the extract. */
  | { status: "error"; message: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "29 Sep 2026 10:05 AEST": announcements are stamped in Sydney time. */
export function formatSydneyStamp(ms: number): string {
  const at = zonedDateTimeParts(ms, ASX_TIME_ZONE);
  const offsetHours = Math.round((Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute) - Math.floor(ms / 60_000) * 60_000) / 3_600_000);
  const zone = offsetHours === 11 ? "AEDT" : offsetHours === 10 ? "AEST" : "";
  return `${String(at.day).padStart(2, "0")} ${MONTHS[at.month - 1]} ${at.year} ${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")} ${zone}`.trim();
}

/** Whether another issuer lodged this announcement: a company's feed carries notices that merely name it. */
export function isOtherIssuer(item: AsxAnnouncement, code: string): boolean {
  return item.code !== "" && item.code !== code;
}

/** The type shown in the list: the plugin's group, or ASX's own label when the group is Other. */
export function typeLabel(item: AsxAnnouncement): string {
  return CATEGORY_SHORT[item.category] || item.types[0] || "Announcement";
}

/** The metadata lines under an announcement's headline, for the pane showing `code`. */
export function describeAnnouncement(item: AsxAnnouncement, code: string): string[] {
  const lines: string[] = [];
  if (isOtherIssuer(item, code)) lines.push(`Lodged by ${item.companyName ?? item.code} (ASX:${item.code})`);
  else if (item.companyName) lines.push(item.companyName);
  lines.push(typeLabel(item));
  lines.push(item.priceSensitive ? "Price sensitive" : "Not price sensitive");
  lines.push(`Released ${formatSydneyStamp(item.releasedAt)}`);
  const size: string[] = [];
  if (item.pages != null) size.push(`${item.pages} ${item.pages === 1 ? "page" : "pages"}`);
  // The feed's size is rounded and does not match the file it serves, so say so.
  if (item.size) size.push(`~${item.size}`);
  if (size.length > 0) lines.push(size.join(", "));
  return lines;
}

const CLOSED_HINT = "Open the announcement to load an extract of its first pages, or press o to open the PDF.";

function extractNote(state: Extract<ExtractState, { status: "ready" }>): string {
  // A shortened extract ends with "…", so the note must not claim whole pages.
  const cut = state.text.endsWith("…");
  if (state.pagesRead >= state.totalPages) {
    return cut ? "Opening of the announcement PDF. Open the PDF for the full text." : "Full text of the announcement PDF.";
  }
  const pages = `${state.pagesRead} of ${state.totalPages} pages`;
  return `${cut ? "Opening of the first" : "Extract of the first"} ${pages}. Open the PDF for the full announcement.`;
}

export function toFeedItems(
  items: readonly AsxAnnouncement[],
  options: { code: string; openId: string | null; extracts: ReadonlyMap<string, ExtractState> },
): FeedDataTableItem[] {
  return items.map((item) => {
    const open = item.id === options.openId;
    const extract = open ? options.extracts.get(item.id) ?? (item.documentKey ? { status: "loading" as const } : null) : null;
    // The feed has no page count; the PDF supplies one once it is read.
    const pages = item.pages ?? (extract?.status === "ready" ? extract.totalPages : null);
    let detailBody: string;
    let detailNote: string | null = null;
    if (!item.documentKey) {
      detailBody = "Press o to open the announcement on asx.com.au.";
    } else if (!extract) {
      detailBody = CLOSED_HINT;
    } else if (extract.status === "loading") {
      detailBody = "Loading the announcement PDF…";
    } else if (extract.status === "error") {
      detailBody = extract.message;
    } else {
      detailBody = extract.text || "The PDF has no extractable text (it may be a scanned image). Press o to open it.";
      detailNote = extractNote(extract);
    }
    return {
      id: item.id,
      eyebrow: typeLabel(item),
      // ASX marks price-sensitive announcements with an asterisk; another issuer's code leads its rows.
      title: `${item.priceSensitive ? "* " : ""}${isOtherIssuer(item, options.code) ? `${item.code} · ` : ""}${item.headline}`,
      timestamp: new Date(item.releasedAt),
      detailTitle: item.headline,
      detailMeta: describeAnnouncement({ ...item, pages }, options.code),
      detailBody,
      detailNote,
    };
  });
}

/**
 * The figures above the list: the company's full name (the title has only its
 * code), ASX's count of its announcements, and when it last released a
 * price-sensitive one (labelled "Price sensitive", the longer label is cut off). No load counts.
 */
export function headerStats(
  all: readonly AsxAnnouncement[],
  options: { code: string; totalItems: number | null; hasMore: boolean; fallbackName: string | null; now?: number },
): StatItem[] {
  // Other issuers' notices name this company but carry their own name.
  const company = all.find((item) => item.code === options.code && item.companyName)?.companyName ?? options.fallbackName ?? options.code;
  // The feed is newest first, so the first flagged row is the latest.
  const sensitive = all.find((item) => item.priceSensitive && !isOtherIssuer(item, options.code));
  const total = options.totalItems ?? (options.hasMore ? null : all.length);
  return [
    { id: "company", label: "Company", value: company },
    ...(total != null ? [{ id: "count", label: "Announcements", value: total.toLocaleString("en-AU") }] : []),
    ...(sensitive ? [{ id: "sensitive", label: "Price sensitive", value: formatReleased(sensitive.releasedAt, options.now), tone: "warning" as const }] : []),
  ];
}

export type FeedColumnId = "time" | "source" | "title";
export type FeedColumn = DataTableColumn & { id: FeedColumnId };
export interface FeedRow { item: FeedDataTableItem; itemIndex: number }

/** Room the table keeps in a header for its sort arrow. */
const HEADER_RESERVED = 2;
const TIME_WIDTH = 12;
const TITLE_MIN_WIDTH = 16;

/** Sydney time, the column, the type and the headline, sized as core's feed table sizes them. */
export function feedColumns(width: number, sourceLabel: string, titleLabel: string, items: readonly FeedDataTableItem[]): FeedColumn[] {
  const sourceCap = Math.min(24, Math.max(14, Math.floor(width * 0.18)));
  let longest = Math.max(displayWidth(sourceLabel), 6);
  for (const item of items) if (item.eyebrow) longest = Math.max(longest, displayWidth(item.eyebrow));
  const sourceWidth = Math.max(Math.min(longest, sourceCap), displayWidth(sourceLabel) + HEADER_RESERVED);
  return [
    { id: "time", label: "Sydney", width: TIME_WIDTH, align: "left" },
    { id: "source", label: sourceLabel, width: sourceWidth, align: "left" },
    { id: "title", label: titleLabel, width: Math.max(TITLE_MIN_WIDTH, width - (TIME_WIDTH + 1) - (sourceWidth + 1) - 3), align: "left" },
  ];
}

function timestampMs(item: FeedDataTableItem): number {
  const ms = item.timestamp ? new Date(item.timestamp).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** `08 Oct 09:23` this year, `08 Oct 2025` before; as the ASXA market pane prints it. */
export function feedTimeText(item: FeedDataTableItem, now = Date.now()): string {
  const ms = timestampMs(item);
  return ms ? formatReleased(ms, now) : "";
}

export function sortFeedRows(items: readonly FeedDataTableItem[], sort: StackSortPreference<FeedColumnId>): FeedRow[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  const text = (a: string, b: string) => a.localeCompare(b, "en-AU", { sensitivity: "base" });
  const compare = (a: FeedRow, b: FeedRow): number => {
    switch (sort.columnId) {
      case "time": return timestampMs(a.item) - timestampMs(b.item);
      case "source": return text(a.item.eyebrow ?? "", b.item.eyebrow ?? "");
      case "title": return text(a.item.title, b.item.title);
    }
  };
  return items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .sort((a, b) => compare(a, b) * direction || a.itemIndex - b.itemIndex);
}
