import { describe, expect, test } from "bun:test";
import type { AsxAnnouncement } from "./model";
import {
  classifyAnnouncement, cleanPdfText, describeAnnouncement, extractSummary, formatSydneyTime,
} from "./summary";

const base: AsxAnnouncement = {
  documentKey: "k", symbol: "CBA", companyName: "COMMONWEALTH BANK OF AUSTRALIA.", headline: "Full Year Results",
  releasedAt: "2026-08-12T22:35:11.000Z", isPriceSensitive: true, types: ["Full Year Results"],
  pageCount: 84, fileSizeBytes: 2097152, pdfUrl: "https://example.invalid/k",
};

describe("classifyAnnouncement", () => {
  const cases: Array<[string, string[], string]> = [
    ["Full Year Results Announcement", [], "Results"],
    ["Half Yearly Report and Accounts", [], "Results"],
    ["Quarterly Activities Report and Appendix 4C", [], "Quarterly"],
    ["Change of Director's Interest Notice", ["Appendix 3Y"], "Director interest"],
    ["Initial Director's Interest Notice", [], "Director interest"],
    ["Trading Halt", [], "Trading halt"],
    ["Reinstatement to Official Quotation", [], "Trading halt"],
    ["Becoming a substantial holder", [], "Substantial holder"],
    ["Change in substantial holding", [], "Substantial holder"],
    ["Dividend/Distribution - CBA", [], "Dividend"],
    ["Notification of buy-back - Appendix 3C", [], "Buy-back"],
    ["Daily share buy-back notice - Appendix 3E", [], "Buy-back"],
    ["Proposed issue of securities - CBA", [], "Capital"],
    ["Application for quotation of securities - CBA", [], "Capital"],
    ["Cleansing Notice", [], "Capital"],
    ["Notice of Annual General Meeting/Proxy Form", [], "AGM"],
    ["Results of Meeting", [], "AGM"],
    ["Investor Presentation", [], "Presentation"],
    ["Response to ASX Price Query", [], "ASX query"],
    ["Ceasing to be a substantial holder", [], "Substantial holder"],
    ["Something unusual", ["Progress Report"], "Progress Report"],
    ["Something unusual", [], "Announcement"],
  ];
  for (const [headline, types, label] of cases) {
    test(`${headline} -> ${label}`, () => {
      expect(classifyAnnouncement(headline, types).label).toBe(label);
    });
  }
});

describe("cleanPdfText", () => {
  test("strips the ASX watermark, page numbers and runs of whitespace", () => {
    const raw = "For personal use only\nASX ANNOUNCEMENT   29 September 2026\n\n\n1\nCommonwealth  Bank completes\nbuy-back.\nFor  personal use only\nPage 2 of 4\n";
    expect(cleanPdfText(raw)).toBe("ASX ANNOUNCEMENT 29 September 2026\nCommonwealth Bank completes buy-back.");
  });

  // The first two pages of CBA's Appendix 3A.1 of 21 Sep 2026, as the live pass extracted them.
  const appendix3a = [
    "Appendix 3A.1 - Notification of dividend / distribution Appendix 3A.1 - Notification of dividend / distribution 1 / 7 Update Summary Entity name COMMONWEALTH BANK OF AUSTRALIA.\nSecurity on which the Distribution will be paid CBA - ORDINARY FULLY PAID",
    "Appendix 3A.1 - Notification of dividend / distribution Appendix 3A.1 - Notification of dividend / distribution 2 / 7 Announcement Details Part 1 - Entity and announcement details",
  ].join("\f");

  test("drops running headers and page counters from form-style PDFs", () => {
    expect(cleanPdfText(appendix3a)).toBe([
      "Appendix 3A.1 - Notification of dividend / distribution Update Summary Entity name COMMONWEALTH BANK OF AUSTRALIA.",
      "Security on which the Distribution will be paid CBA - ORDINARY FULLY PAID Announcement Details Part 1 - Entity and announcement details",
    ].join("\n"));
  });

  test("keeps page-like numbers in the body and pages that start differently", () => {
    const raw = "Letter to shareholders\nThe vote passed 50 / 50 on the day.\fDear shareholder, the result stands.";
    expect(cleanPdfText(raw)).toBe("Letter to shareholders The vote passed 50 / 50 on the day.\nDear shareholder, the result stands.");
  });

  test("collapses a heading printed twice on a single-page document", () => {
    expect(cleanPdfText("Notice of ceasing holding Notice of ceasing holding The holder sold.")).toBe("Notice of ceasing holding The holder sold.");
  });

  test("handles the watermark run together by the extractor", () => {
    expect(cleanPdfText("Forpersonaluseonly Results are strong.")).toBe("Results are strong.");
  });
});

describe("extractSummary", () => {
  test("keeps whole sentences up to the limit and marks truncation", () => {
    const text = "First sentence here. Second sentence follows. Third sentence is long enough to be cut off entirely.";
    const summary = extractSummary(text, { maxChars: 50 });
    expect(summary).toBe("First sentence here. Second sentence follows. …");
  });

  test("returns the whole text when it fits", () => {
    expect(extractSummary("Short.", { maxChars: 50 })).toBe("Short.");
  });

  test("hard-cuts a single run-on sentence", () => {
    const summary = extractSummary("x".repeat(200), { maxChars: 50 });
    expect(summary.length).toBeLessThanOrEqual(52);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("formatSydneyTime", () => {
  test("converts UTC to Sydney standard time", () => {
    expect(formatSydneyTime("2026-09-29T00:05:00.000Z")).toBe("29 Sep 2026 10:05 AEST");
  });
  test("converts UTC to Sydney daylight time", () => {
    expect(formatSydneyTime("2026-03-25T02:30:11.000Z")).toBe("25 Mar 2026 13:30 AEDT");
  });
  test("passes through unparseable input", () => {
    expect(formatSydneyTime("not a date")).toBe("not a date");
  });
});

describe("describeAnnouncement", () => {
  test("produces the metadata lines shown under the headline", () => {
    expect(describeAnnouncement(base)).toEqual([
      "COMMONWEALTH BANK OF AUSTRALIA.",
      "Results",
      "Price sensitive",
      "Released 13 Aug 2026 08:35 AEST",
      "84 pages, ~2.0 MB",
    ]);
  });

  test("names the lodging issuer when another company lodged it", () => {
    const car = { ...base, symbol: "CAR", companyName: "CAR GROUP LIMITED" };
    expect(describeAnnouncement(car, { code: "CBA" })[0]).toBe("Lodged by CAR GROUP LIMITED (ASX:CAR)");
    expect(describeAnnouncement(base, { code: "CBA" })[0]).toBe("COMMONWEALTH BANK OF AUSTRALIA.");
  });

  test("omits what it does not know", () => {
    const sparse = { ...base, companyName: null, isPriceSensitive: false, pageCount: null, fileSizeBytes: null, types: [] };
    expect(describeAnnouncement(sparse)).toEqual([
      "Results",
      "Not price sensitive",
      "Released 13 Aug 2026 08:35 AEST",
    ]);
  });
});
