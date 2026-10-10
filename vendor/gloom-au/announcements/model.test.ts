import { describe, expect, test } from "bun:test";
import {
  UnknownAsxCodeError,
  classifyAnnouncement,
  parseAsxDateTime,
  parseCompanyAnnouncementsHtml,
  parseMarketAnnouncementsJson,
} from "./model";

const companyHtml = await Bun.file(new URL("./fixtures/company-bhp.html", import.meta.url)).text();
const marketJson = await Bun.file(new URL("./fixtures/market.json", import.meta.url)).json();

describe("parseCompanyAnnouncementsHtml", () => {
  test("reads rows from the ASX company page, newest first, with document links", () => {
    const rows = parseCompanyAnnouncementsHtml(companyHtml, "BHP");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      id: "ids:03149953",
      code: "BHP",
      headline: "Update - Dividend/Distribution - BHP",
      category: "dividend",
      pages: 6,
      size: "19.6KB",
      priceSensitive: false,
      documentUrl: "https://www.asx.com.au/asx/v2/statistics/displayAnnouncement.do?display=pdf&idsId=03149953",
    });
    // 08/10/2026 9:23 am Sydney (AEDT, UTC+11).
    expect(new Date(rows[0]!.releasedAt).toISOString()).toBe("2026-10-07T22:23:00.000Z");
    expect(rows.filter((row) => row.priceSensitive)).toHaveLength(1);
    expect(rows.map((row) => row.releasedAt)).toEqual([...rows.map((row) => row.releasedAt)].sort((a, b) => b - a));
  });

  test("an empty list is valid, but an unknown code or a changed page is an error, never an empty list", () => {
    expect(parseCompanyAnnouncementsHtml("<announcement_data><table><tbody></tbody></table></announcement_data>", "BHP")).toEqual([]);
    expect(() => parseCompanyAnnouncementsHtml("<p>The ASX code you entered does not match any companies code.</p>", "ZZZ"))
      .toThrow(UnknownAsxCodeError);
    expect(() => parseCompanyAnnouncementsHtml("<html><body>maintenance</body></html>", "BHP")).toThrow(/not recognised/);
  });
});

describe("parseMarketAnnouncementsJson", () => {
  test("reads the market feed with PDF links, keeping ASX type labels", () => {
    const rows = parseMarketAnnouncementsJson(marketJson);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.priceSensitive && row.documentUrl?.startsWith("https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/"))).toBe(true);
    const scheme = rows.find((row) => /scheme booklet/i.test(row.headline));
    expect(scheme?.category).toBe("takeover");
    expect(scheme?.types).toContain("Scheme of Arrangement");
  });

  test("items that no longer parse are a format error, not a quiet day", () => {
    expect(parseMarketAnnouncementsJson({ data: { items: [] } })).toEqual([]);
    expect(() => parseMarketAnnouncementsJson({ data: { items: [{ title: "x" }] } })).toThrow(/not recognised/);
    expect(() => parseMarketAnnouncementsJson({ error: "x" })).toThrow(/not recognised/);
  });
});

describe("parseAsxDateTime", () => {
  test("converts Sydney wall-clock time across daylight saving and the 12 o'clock hours", () => {
    // AEST (UTC+10) in June, AEDT (UTC+11) in December.
    expect(new Date(parseAsxDateTime("15/06/2026", "12:05 pm")!).toISOString()).toBe("2026-06-15T02:05:00.000Z");
    expect(new Date(parseAsxDateTime("15/12/2026", "12:05 am")!).toISOString()).toBe("2026-12-14T13:05:00.000Z");
    expect(parseAsxDateTime("2026-06-15", "9:00 am")).toBeNull();
  });
});

describe("classifyAnnouncement", () => {
  test.each([
    ["Change of Director's Interest Notice", "directors"],
    ["Appendix 3Y - J Smith", "directors"],
    ["Change in substantial holding", "substantial"],
    ["Ceasing to be a substantial holder", "substantial"],
    ["Results of Meeting", "meeting"],
    ["Appendix 4D and Half Year Report", "results"],
    ["Quarterly Activities/Appendix 4C Cash Flow Report", "results"],
    ["Bidder's Statement", "takeover"],
    ["Dividend/Distribution - BHP", "dividend"],
    ["Application for quotation of securities - CBA", "capital"],
    ["Proxy Form", "meeting"],
    ["Notice Under s708A", "capital"],
    ["Trading Halt", "halt"],
    ["Response to ASX Price Query", "query"],
    ["Top 20 Holders and Distribution Schedule", "other"],
  ] as const)("%s is %s", (headline, category) => {
    expect(classifyAnnouncement(headline)).toBe(category);
  });

  test("an annual report that ASX also tags Top 20 shareholders is results, not other", () => {
    // BHP's full-year release in the live feed, with ASX's types in feed order.
    const types = ["Dividend Reinvestment Plan", "Annual Report", "Top 20 shareholders", "Preliminary Final Report"];
    expect(classifyAnnouncement("BHP Appendix 4E and 2026 Annual Report", types)).toBe("results");
    expect(classifyAnnouncement("Top 20 Holders and Distribution Schedule", ["Top 20 shareholders", "Distribution Schedule"])).toBe("other");
  });
});
