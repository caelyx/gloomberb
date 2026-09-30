import { describe, expect, test } from "bun:test";
import { ExtractUnavailableError } from "../asx/extract-error";
import type { AsxAnnouncement } from "../asx/model";
import page0 from "../../test/fixtures/announcements-cba-page0.json";
import { parseAnnouncementsPage } from "../asx/parse";
import { filterAnnouncements, headerStats, notAsxMessage, toFeedItems } from "./view-model";

// CBA's ten newest items on 29 Sep 2026; the first two were lodged by CAR Group.
const live = parseAnnouncementsPage(page0, { page: 0, itemsPerPage: 10 });

const a = (over: Partial<AsxAnnouncement>): AsxAnnouncement => ({
  documentKey: "k", symbol: "CBA", companyName: "CBA Ltd", headline: "Headline", releasedAt: "2026-09-29T00:05:00.000Z",
  isPriceSensitive: false, types: [], pageCount: null, fileSizeBytes: null, pdfUrl: "https://example.invalid/k", ...over,
});

describe("filterAnnouncements", () => {
  test("sensitiveOnly keeps price-sensitive items", () => {
    const items = [a({ documentKey: "1", isPriceSensitive: true }), a({ documentKey: "2" })];
    expect(filterAnnouncements(items, { sensitiveOnly: true }).map((i) => i.documentKey)).toEqual(["1"]);
    expect(filterAnnouncements(items, { sensitiveOnly: false })).toHaveLength(2);
  });
});

describe("toFeedItems", () => {
  test("marks price-sensitive rows the way ASX does and labels the kind", () => {
    const items = toFeedItems([a({ documentKey: "1", headline: "Trading Halt", isPriceSensitive: true })], { code: "CBA", openId: null, extracts: new Map() });
    expect(items[0]).toMatchObject({ id: "1", eyebrow: "Trading halt", title: "$ Trading Halt", timestamp: "2026-09-29T00:05:00.000Z" });
  });

  test("closed rows show metadata; the open row shows the extract state", () => {
    const list = [a({ documentKey: "1" }), a({ documentKey: "2" })];
    const extracts = new Map([["2", { status: "loading" as const }]]);
    const items = toFeedItems(list, { code: "CBA", openId: "2", extracts });
    expect(items[0]?.detailBody).toContain("Open the announcement to load an extract");
    expect(items[1]?.detailBody).toBe("Loading the announcement PDF…");
  });

  test("a ready extract is shown with its page note", () => {
    const extracts = new Map([["1", { status: "ready" as const, text: "Body text.", totalPages: 12, pagesRead: 2 }]]);
    const [item] = toFeedItems([a({ documentKey: "1" })], { code: "CBA", openId: "1", extracts });
    expect(item?.detailBody).toBe("Body text.");
    expect(item?.detailNote).toBe("Extract of the first 2 of 12 pages. Open the PDF for the full announcement.");
  });

  test("a ready extract supplies the page count the feed lacks", () => {
    const extracts = new Map([["1", { status: "ready" as const, text: "Body text.", totalPages: 7, pagesRead: 2 }]]);
    const [item] = toFeedItems([a({ documentKey: "1", fileSizeBytes: 19 * 1024 })], { code: "CBA", openId: "1", extracts });
    expect(item?.detailMeta).toContain("7 pages, ~19 KB");
  });

  test("a shortened extract is not described as whole pages", () => {
    const extracts = new Map([["1", { status: "ready" as const, text: "Opening sentence. …", totalPages: 7, pagesRead: 2 }]]);
    const [item] = toFeedItems([a({ documentKey: "1" })], { code: "CBA", openId: "1", extracts });
    expect(item?.detailNote).toBe("Opening of the first 2 of 7 pages. Open the PDF for the full announcement.");
  });

  test("rows lodged by another issuer lead with its code and name it", () => {
    const items = toFeedItems(live.items, { code: "CBA", openId: null, extracts: new Map() });
    expect(items[0]?.title).toBe("CAR · Ceasing to be a substantial holder from CBA");
    expect(items[0]?.detailMeta?.[0]).toBe("Lodged by CAR GROUP LIMITED (ASX:CAR)");
    const dividend = items.find((item) => item.detailTitle === "Update - Dividend/Distribution - CBA");
    expect(dividend?.title).toBe("Update - Dividend/Distribution - CBA");
    expect(toFeedItems([a({ symbol: "", headline: "No symbol" })], { code: "CBA", openId: null, extracts: new Map() })[0]?.title).toBe("No symbol");
  });

  test("an extract failure is reported in place and the row keeps its metadata", () => {
    const message = new ExtractUnavailableError("too-large").message;
    const extracts = new Map([["1", { status: "error" as const, message }]]);
    const [item] = toFeedItems([a({ documentKey: "1", headline: "Annual Report" })], { code: "CBA", openId: "1", extracts });
    expect(item?.detailBody).toBe(message);
    expect(item?.detailBody).toContain("Open the original PDF");
    expect(item?.detailTitle).toBe("Annual Report");
    expect(item?.detailMeta?.length).toBeGreaterThan(0);
  });
});

describe("headerStats", () => {
  const options = { code: "CBA", totalItems: 7773, hasMore: true, fallbackName: "Commonwealth Bank" };

  test("names the company from its own rows, not the other issuers' that come first", () => {
    const [company] = headerStats(live.items, options);
    expect(company).toMatchObject({ value: "COMMONWEALTH BANK OF AUSTRALIA.", detail: "ASX:CBA" });
  });

  test("falls back to Gloomberb's name, then the code, when no row is the company's own", () => {
    const others = live.items.filter((item) => item.symbol === "CAR");
    expect(headerStats(others, options)[0]?.value).toBe("Commonwealth Bank");
    expect(headerStats(others, { ...options, fallbackName: null })[0]?.value).toBe("CBA");
  });

  test("gives the feed's total and says the other counts cover loaded rows", () => {
    const [, count, sensitive] = headerStats(live.items, options);
    expect(count).toMatchObject({ label: "Announcements", value: "7,773", detail: "10 loaded" });
    expect(sensitive).toMatchObject({ value: "0", detail: "in 10 loaded", tone: "muted" });
  });

  test("without a total, counts the loaded rows", () => {
    expect(headerStats(live.items, { ...options, totalItems: null })[1]).toMatchObject({ value: "10", detail: "more on scroll" });
  });
});

describe("notAsxMessage", () => {
  test("tells the user how to reach the ASX listing", () => {
    expect(notAsxMessage("BHP")).toBe("BHP is not an ASX listing. For the ASX listing, name the exchange: ASX BHP.AX");
    expect(notAsxMessage("BHP:NYSE")).toBe("BHP:NYSE is not an ASX listing. For the ASX listing, name the exchange: ASX BHP.AX");
  });
});
