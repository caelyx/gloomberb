import { describe, expect, test } from "bun:test";
import predictive from "../../test/fixtures/predictive-cba.json";
import page0 from "../../test/fixtures/announcements-cba-page0.json";
import { parseAnnouncementsPage, parsePredictiveSearch, pickEntityForCode } from "./parse";

describe("parsePredictiveSearch", () => {
  test("reads the live shape, where xidEntity is a number", () => {
    expect(parsePredictiveSearch(predictive)).toEqual([
      { xid: "204245597", symbol: "CBA", displayName: "COMMONWEALTH BANK OF AUSTRALIA." },
    ]);
  });

  test("tolerates garbage", () => {
    expect(parsePredictiveSearch(null)).toEqual([]);
    expect(parsePredictiveSearch({ data: { items: [{ nope: 1 }] } })).toEqual([]);
  });
});

describe("pickEntityForCode", () => {
  const matches = parsePredictiveSearch({ data: { items: [
    { xidEntity: 1, symbol: "CBAPM", displayName: "CBA PERLS" },
    ...predictive.data.items,
  ] } });

  test("prefers the exact symbol over the first result", () => {
    expect(pickEntityForCode(matches, "cba")?.xid).toBe("204245597");
  });

  test("returns null when nothing matches the code exactly", () => {
    expect(pickEntityForCode(matches, "BHP")).toBeNull();
  });

  test("falls back to the only result when the API omits symbols", () => {
    expect(pickEntityForCode([{ xid: "1", symbol: "", displayName: null }], "CBA")?.xid).toBe("1");
  });
});

describe("parseAnnouncementsPage", () => {
  // Captured live on 29 Sep 2026 (see test/fixtures/README.md).
  const page = parseAnnouncementsPage(page0, { page: 0, itemsPerPage: 10 });

  test("keeps every live item and sorts newest first", () => {
    const shuffled = { data: { ...page0.data, items: [...page0.data.items].reverse() } };
    const sorted = parseAnnouncementsPage(shuffled, { page: 0, itemsPerPage: 10 });
    expect(sorted.items).toHaveLength(10);
    expect(sorted.items[0]?.documentKey).toBe("2924-03141253-3A702773");
    expect(sorted.items.map((a) => a.releasedAt)).toEqual([...sorted.items.map((a) => a.releasedAt)].sort().reverse());
  });

  test("drops items without a document key or headline", () => {
    const raw = { data: { items: [{ headline: "No key" }, { documentKey: "k" }, ...page0.data.items.slice(0, 1)] } };
    expect(parseAnnouncementsPage(raw, { page: 0, itemsPerPage: 50 }).items.map((a) => a.documentKey)).toEqual([
      "2924-03141253-3A702773",
    ]);
  });

  test("maps the fields the pane needs", () => {
    const dividend = page.items.find((a) => a.headline === "Update - Dividend/Distribution - CBA")!;
    expect(dividend.symbol).toBe("CBA");
    expect(dividend.companyName).toBe("COMMONWEALTH BANK OF AUSTRALIA.");
    expect(dividend.releasedAt).toBe("2026-09-21T06:36:16.000Z");
    expect(dividend.isPriceSensitive).toBe(false);
    expect(dividend.types).toEqual(["Dividend Reinvestment Plan", "Dividend Record Date", "Dividend Pay Date", "Dividend Rate"]);
    expect(dividend.fileSizeBytes).toBe(19 * 1024);
    expect(dividend.pdfUrl).toBe(
      `https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/${dividend.documentKey}`,
    );
  });

  test("keeps another issuer's notice under that issuer's code and name", () => {
    const notice = page.items[0]!;
    expect(notice.headline).toBe("Ceasing to be a substantial holder from CBA");
    expect(notice.symbol).toBe("CAR");
    expect(notice.companyName).toBe("CAR GROUP LIMITED");
    expect(notice.fileSizeBytes).toBe(257 * 1024);
  });

  test("the live feed has no page count, and its empty url falls back to the Markit PDF link", () => {
    expect(page.items.every((a) => a.pageCount === null)).toBe(true);
    expect(page.items.every((a) => a.pdfUrl.endsWith(`/file/${a.documentKey}`))).toBe(true);
  });

  test("picks the companyInfo entry that matches the item's symbol", () => {
    const raw = { data: { items: [{
      documentKey: "k", headline: "h", symbol: "CBA",
      companyInfo: [{ symbol: "CAR", displayName: "CAR GROUP LIMITED" }, { symbol: "CBA", displayName: "COMMONWEALTH BANK OF AUSTRALIA." }],
    }] } };
    expect(parseAnnouncementsPage(raw, { page: 0, itemsPerPage: 50 }).items[0]?.companyName).toBe("COMMONWEALTH BANK OF AUSTRALIA.");
  });

  test("missing optional fields become null or empty", () => {
    const [bare] = parseAnnouncementsPage({ data: { items: [{ documentKey: "k", headline: "h" }] } }, { page: 0, itemsPerPage: 50 }).items;
    expect(bare?.companyName).toBeNull();
    expect(bare?.types).toEqual([]);
    expect(bare?.pageCount).toBeNull();
    expect(bare?.fileSizeBytes).toBeNull();
  });

  test("reads file sizes with units and ignores ones it cannot read", () => {
    const sizes = ["12KB", "2.5MB", "900 B", "4096", "big"].map((fileSize) =>
      parseAnnouncementsPage({ data: { items: [{ documentKey: "k", headline: "h", fileSize }] } }, { page: 0, itemsPerPage: 50 }).items[0]?.fileSizeBytes);
    expect(sizes).toEqual([12 * 1024, Math.round(2.5 * 1024 * 1024), 900, 4096, null]);
  });

  test("uses the live count for hasMore", () => {
    expect(page.totalItems).toBe(7773);
    expect(page.hasMore).toBe(true);
    const last = parseAnnouncementsPage(page0, { page: 777, itemsPerPage: 10 });
    expect(last.hasMore).toBe(false);
  });

  test("an empty page ends paging even if the total says there is more", () => {
    expect(parseAnnouncementsPage({ data: { items: [], count: 7773 } }, { page: 5, itemsPerPage: 50 }).hasMore).toBe(false);
  });

  test("falls back to a full page meaning more may exist", () => {
    const raw = { data: { items: page0.data.items.slice(0, 3) } };
    expect(parseAnnouncementsPage(raw, { page: 0, itemsPerPage: 3 }).hasMore).toBe(true);
    expect(parseAnnouncementsPage(raw, { page: 0, itemsPerPage: 50 }).hasMore).toBe(false);
  });

  test("accepts alternative spellings seen in other ASX feeds", () => {
    const raw = { data: { items: [{
      documentKey: "k1", header: "Alt headline", documentDate: "2026-01-02T03:04:05Z",
      marketSensitive: "Y", types: [{ name: "Progress Report" }], companyName: "Alt Co", pages: "12", size: "4096",
    }] } };
    const [item] = parseAnnouncementsPage(raw, { page: 0, itemsPerPage: 50 }).items;
    expect(item?.headline).toBe("Alt headline");
    expect(item?.releasedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(item?.isPriceSensitive).toBe(true);
    expect(item?.types).toEqual(["Progress Report"]);
    expect(item?.companyName).toBe("Alt Co");
    expect(item?.pageCount).toBe(12);
    expect(item?.fileSizeBytes).toBe(4096);
  });

  test("passes the access token into pdf links", () => {
    const withToken = parseAnnouncementsPage(page0, { page: 0, itemsPerPage: 50, accessToken: "tok" });
    expect(withToken.items[0]?.pdfUrl.endsWith("?access_token=tok")).toBe(true);
  });
});
