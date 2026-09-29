import type { FeedDataTableItem, StatItem } from "gloomberb/components";
import type { AsxAnnouncement } from "../asx/model";
import { classifyAnnouncement, describeAnnouncement, isOtherIssuer } from "../asx/summary";

export type ExtractState =
  | { status: "loading" }
  | { status: "ready"; text: string; totalPages: number; pagesRead: number }
  /** `message` is shown as is in place of the extract. */
  | { status: "error"; message: string };

export interface FeedOptions {
  /** The ASX code the pane shows; rows lodged under another code are marked. */
  code: string;
  openId: string | null;
  extracts: ReadonlyMap<string, ExtractState>;
}

export function filterAnnouncements(items: readonly AsxAnnouncement[], { sensitiveOnly }: { sensitiveOnly: boolean }): AsxAnnouncement[] {
  return sensitiveOnly ? items.filter((item) => item.isPriceSensitive) : [...items];
}

const CLOSED_HINT = "Open the announcement to load an extract of its first pages, or press o to open the PDF in your browser.";

function extractNote(state: Extract<ExtractState, { status: "ready" }>): string {
  // extractSummary ends a shortened text with "…", so the note must not claim whole pages.
  const cut = state.text.endsWith("…");
  if (state.pagesRead >= state.totalPages) {
    return cut ? "Opening of the announcement PDF. Open the PDF for the full text." : "Full text of the announcement PDF.";
  }
  const pages = `${state.pagesRead} of ${state.totalPages} pages`;
  return `${cut ? "Opening of the first" : "Extract of the first"} ${pages}. Open the PDF for the full announcement.`;
}

export function toFeedItems(items: readonly AsxAnnouncement[], { code, openId, extracts }: FeedOptions): FeedDataTableItem[] {
  return items.map((announcement) => {
    const { label } = classifyAnnouncement(announcement.headline, announcement.types);
    const open = announcement.documentKey === openId;
    const extract = open ? extracts.get(announcement.documentKey) ?? { status: "loading" as const } : null;
    // The feed has no page count; the PDF itself supplies one once it is read.
    const pageCount = announcement.pageCount ?? (extract?.status === "ready" ? extract.totalPages : null);
    const meta = describeAnnouncement({ ...announcement, pageCount }, { code });
    let detailBody: string;
    let detailNote: string | null = null;
    if (!extract) {
      detailBody = CLOSED_HINT;
    } else if (extract.status === "loading") {
      detailBody = "Loading the announcement PDF…";
    } else if (extract.status === "error") {
      detailBody = extract.message;
    } else {
      detailBody = extract.text || "The PDF has no extractable text (it may be a scanned image). Open the PDF to read it.";
      detailNote = extractNote(extract);
    }
    return {
      id: announcement.documentKey,
      eyebrow: label,
      // ASX marks price-sensitive announcements with "$" on its own pages; another issuer's code leads its rows.
      title: `${announcement.isPriceSensitive ? "$ " : ""}${isOtherIssuer(announcement, code) ? `${announcement.symbol} · ` : ""}${announcement.headline}`,
      timestamp: announcement.releasedAt || null,
      detailTitle: announcement.headline,
      detailMeta: meta,
      detailBody,
      detailNote,
    };
  });
}

export interface HeaderOptions {
  code: string;
  totalItems: number | null;
  hasMore: boolean;
  /** Gloomberb's name for the ticker, used when no loaded row is the company's own. */
  fallbackName: string | null;
}

/** The figures above the list. Counts cover the loaded rows only, so the details say so. */
export function headerStats(all: readonly AsxAnnouncement[], { code, totalItems, hasMore, fallbackName }: HeaderOptions): StatItem[] {
  // Other issuers' notices name this company but carry their own name.
  const company = all.find((item) => item.symbol === code && item.companyName)?.companyName ?? fallbackName ?? code;
  const sensitiveCount = all.filter((item) => item.isPriceSensitive).length;
  const loaded = `${all.length.toLocaleString("en-AU")} loaded`;
  return [
    { id: "company", label: "Company", value: company, detail: `ASX:${code}` },
    totalItems != null
      ? { id: "count", label: "Announcements", value: totalItems.toLocaleString("en-AU"), detail: loaded }
      : { id: "count", label: "Announcements", value: all.length.toLocaleString("en-AU"), detail: hasMore ? "more on scroll" : "" },
    { id: "sensitive", label: "Price sensitive", value: String(sensitiveCount), detail: `in ${loaded}`, tone: sensitiveCount > 0 ? "warning" : "muted" },
  ];
}

/**
 * Only the floating pane can show a non-ASX ticker (the tab is hidden for them). Gloomberb resolves a bare
 * code such as `ASX BHP` to whichever listing its search prefers, often the US one, so name the fix.
 */
export function notAsxMessage(symbol: string): string {
  const code = symbol.trim().split(/[:.]/)[0]?.toUpperCase() || symbol;
  return `${symbol} is not an ASX listing. For the ASX listing, name the exchange: ASX ${code}.AX`;
}
