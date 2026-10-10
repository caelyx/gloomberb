import type { HeadlessPaneContext, HeadlessPaneDefinition, HeadlessPaneRow } from "gloomberb/types/plugin";
import { asxCodeFromSymbol } from "../shared/asx";
import { refreshNotice } from "../shared/cache-status";
import { loadCompanyAnnouncements, loadMarketFeed } from "./client";
import {
  CATEGORY_LABELS,
  filterAnnouncements,
  type AnnouncementCategory,
  type AnnouncementFilter,
  type AnnouncementPeriod,
  type AsxAnnouncement,
} from "./model";

const FILTER_VALUES: AnnouncementFilter[] = [
  "all", "sensitive", "results", "directors", "substantial", "takeover", "dividend", "capital", "meeting", "other",
];

function formatSydney(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function toRow(row: AsxAnnouncement): HeadlessPaneRow {
  return {
    released: new Date(row.releasedAt).toISOString(),
    code: row.code,
    priceSensitive: row.priceSensitive,
    category: row.category,
    headline: row.headline,
    pages: row.pages,
    url: row.documentUrl,
  };
}

async function resolveCode(symbol: string, ctx: HeadlessPaneContext): Promise<string | null> {
  const direct = asxCodeFromSymbol(symbol);
  if (direct) return direct;
  const resolved = await ctx.resolveInstrument?.(symbol);
  return resolved ? asxCodeFromSymbol(resolved.symbol, resolved.exchange) : null;
}

/** `gloomberb fn ASXA` for the market feed, `gloomberb fn ASXA BHP.AX` for one company. */
export const announcementsHeadless = {
  shape: "rows",
  argument: {
    kind: "ticker",
    placeholder: "ASX ticker",
    optional: true,
    description: "An ASX listing such as BHP.AX. Without one, the latest announcements across the market.",
  },
  options: [
    {
      key: "filter",
      description: "Price-sensitive only, or one announcement type.",
      type: "enum",
      values: FILTER_VALUES.map((value) => ({ value })),
      defaultValue: "all",
    },
    {
      key: "period",
      description: "Company announcements: M6 for the last six months, or a calendar year such as 2025.",
      type: "string",
      defaultValue: "M6",
    },
  ],
  columns: [
    { key: "released", header: "Released (Sydney)", format: (value) => formatSydney(Date.parse(String(value))) },
    { key: "code", header: "Code" },
    { key: "priceSensitive", header: "Sens", align: "center", format: (value) => (value ? "*" : "") },
    { key: "category", header: "Type", format: (value) => (value === "other" ? "" : CATEGORY_LABELS[value as AnnouncementCategory] ?? "") },
    { key: "headline", header: "Headline" },
    { key: "pages", header: "Pages", align: "right", format: (value) => (value == null ? "" : String(value)) },
  ],
  describe: (args) => (args.symbols[0] ? `ASX announcements | ${args.symbols[0]}` : "ASX announcements | market"),
  // Filings as ASX publishes them.
  freshness: { source: "ASX", status: "not-a-feed", basis: "company announcements" },
  async load(args, ctx) {
    const filter = (args.options.filter as AnnouncementFilter | undefined) ?? "all";
    const symbol = args.symbols[0];
    if (!symbol) {
      const feed = await loadMarketFeed(
        { priceSensitiveOnly: filter === "sensitive", limit: 200 },
        { force: ctx.refresh, signal: ctx.signal },
      );
      return {
        rows: filterAnnouncements(feed.data, filter).map(toRow),
        metadata: { scope: "market" },
        ...(feed.refreshError ? { notes: refreshNotice(feed) } : {}),
      };
    }
    const code = await resolveCode(symbol, ctx);
    if (!code) {
      return { rows: [], unavailableSymbols: [symbol], errors: [`${symbol} is not an ASX listing.`] };
    }
    const rawPeriod = String(args.options.period ?? "M6").toUpperCase();
    if (rawPeriod !== "M6" && !/^(19|20)\d{2}$/.test(rawPeriod)) {
      throw new Error("period must be M6 or a calendar year such as 2025");
    }
    const rows = await loadCompanyAnnouncements(code, rawPeriod as AnnouncementPeriod, { force: ctx.refresh, signal: ctx.signal });
    return {
      rows: filterAnnouncements(rows, filter).map(toRow),
      symbols: [symbol],
      metadata: { scope: "company", code, period: rawPeriod },
    };
  },
} satisfies HeadlessPaneDefinition<"rows">;
