import { describe, expect, test } from "bun:test";
import page0 from "./fixtures/announcements-cba-page0.json";
import { feedColumns, feedTimeText, formatSydneyStamp, headerStats, sortFeedRows, toFeedItems } from "./company-model";
import { ExtractUnavailableError } from "./extract/errors";
import { parseFeedPage } from "./feed";
import type { AsxAnnouncement } from "./model";

const live = parseFeedPage(page0, 0, 10).items;
const item = (over: Partial<AsxAnnouncement>): AsxAnnouncement => ({
  id: "1", code: "CBA", companyName: "CBA Ltd", documentKey: "k", releasedAt: Date.parse("2026-09-29T00:05:00Z"), headline: "Headline",
  priceSensitive: false, category: "other", types: [], pages: null, size: null, documentUrl: "https://example.invalid/k", ...over,
});

describe("toFeedItems", () => {
  test("rows lodged by another issuer lead with its code and are named in the detail", () => {
    const rows = toFeedItems(live, { code: "CBA", openId: null, extracts: new Map() });
    expect(rows[0]?.title).toBe("CAR · Ceasing to be a substantial holder from CBA");
    expect(rows[0]?.detailMeta?.[0]).toBe("Lodged by CAR GROUP LIMITED (ASX:CAR)");
    expect(rows.find((row) => row.detailTitle === "Update - Dividend/Distribution - CBA")?.title).toBe("Update - Dividend/Distribution - CBA");
  });

  test("the open row shows its extract's state; a ready one supplies the page count the feed lacks", () => {
    const ready = new Map([["1", { status: "ready" as const, text: "Opening sentence. …", totalPages: 7, pagesRead: 2 }]]);
    const [row] = toFeedItems([item({ priceSensitive: true, size: "19KB" })], { code: "CBA", openId: "1", extracts: ready });
    expect(row?.title).toBe("* Headline");
    expect(row?.detailBody).toBe("Opening sentence. …");
    expect(row?.detailNote).toBe("Opening of the first 2 of 7 pages. Open the PDF for the full announcement.");
    expect(row?.detailMeta).toContain("7 pages, ~19KB");
    const failed = new Map([["1", { status: "error" as const, message: new ExtractUnavailableError("too-large").message }]]);
    expect(toFeedItems([item({})], { code: "CBA", openId: "1", extracts: failed })[0]?.detailBody).toContain("too large");
    expect(toFeedItems([item({})], { code: "CBA", openId: null, extracts: new Map() })[0]?.detailBody).toContain("Open the announcement to load an extract");
  });
});

describe("headerStats and times", () => {
  test("names the company from its own rows, not other issuers' that come first", () => {
    const stats = headerStats(live, { code: "CBA", totalItems: 7773, hasMore: true, fallbackName: null });
    expect(stats[0]).toEqual({ id: "company", label: "Company", value: "COMMONWEALTH BANK OF AUSTRALIA." });
    expect(stats[1]).toEqual({ id: "count", label: "Announcements", value: "7,773" });
  });

  test("no load counts: ASX's total, else the rows when all are loaded, and the latest price-sensitive release", () => {
    const now = Date.parse("2026-10-10T02:00:00Z");
    const rows = [
      item({ id: "a", code: "CAR", priceSensitive: true, releasedAt: Date.parse("2026-10-09T22:00:00Z") }),
      item({ id: "b", priceSensitive: true, releasedAt: Date.parse("2026-10-08T22:23:00Z") }),
      item({ id: "c", priceSensitive: true, releasedAt: Date.parse("2026-09-01T00:00:00Z") }),
    ];
    const stats = headerStats(rows, { code: "CBA", totalItems: null, hasMore: false, fallbackName: null, now });
    expect(stats.map((stat) => [stat.label, stat.value])).toEqual([["Company", "CBA Ltd"], ["Announcements", "3"], ["Price sensitive", "09 Oct 09:23"]]);
    for (const stat of stats) expect(String(stat.detail ?? "")).not.toContain("loaded");
    // With more to load and no total from ASX, there is no count to give.
    expect(headerStats([item({})], { code: "CBA", totalItems: null, hasMore: true, fallbackName: null }).map((stat) => stat.id)).toEqual(["company"]);
  });

  test("stamps Sydney time with the zone in force", () => {
    expect(formatSydneyStamp(Date.parse("2026-09-29T00:05:00Z"))).toBe("29 Sep 2026 10:05 AEST");
    expect(formatSydneyStamp(Date.parse("2026-10-08T22:23:00Z"))).toBe("09 Oct 2026 09:23 AEDT");
  });
});

describe("Sydney time column", () => {
  const now = Date.parse("2026-10-10T02:00:00Z");
  test("prints Sydney day and time this year, the year before it, never a US date", () => {
    // 22:23 UTC on 8 Oct is 09:23 AEDT on 9 Oct in Sydney, whatever the local zone.
    expect(feedTimeText({ id: "a", title: "x", timestamp: new Date("2026-10-08T22:23:00Z") }, now)).toBe("09 Oct 09:23");
    expect(feedTimeText({ id: "b", title: "x", timestamp: new Date("2025-09-16T00:00:00Z") }, now)).toBe("16 Sep 2025");
    expect(feedTimeText({ id: "c", title: "x", timestamp: null }, now)).toBe("");
  });

  test("columns fill the width and rows sort newest first by default", () => {
    const items = [
      { id: "old", title: "Old", eyebrow: "Results", timestamp: new Date("2026-08-18T00:00:00Z") },
      { id: "new", title: "New", eyebrow: "Dividend", timestamp: new Date("2026-10-08T00:00:00Z") },
    ];
    const columns = feedColumns(100, "Type", "Announcement", items);
    expect(columns.map((column) => column.label)).toEqual(["Sydney", "Type", "Announcement"]);
    expect(columns.reduce((total, column) => total + column.width + 1, 2)).toBe(100);
    expect(sortFeedRows(items, { columnId: "time", direction: "desc" }).map((row) => row.item.id)).toEqual(["new", "old"]);
    expect(sortFeedRows(items, { columnId: "source", direction: "asc" }).map((row) => row.itemIndex)).toEqual([1, 0]);
  });
});
