import { describe, expect, test } from "bun:test";
import { defaultHistoryRow, historyFor, parseReportIndex, productName, reportedSeries, parseShortCsv, selectHistoryFiles, weekChange, type ReportFile } from "./model";

const CSV = `Product,Product Code,Reported Short Positions,Total Product in Issue,% of Total Product in Issue Reported as Short Positions
BHP GROUP LIMITED ORDINARY,BHP,80578328,5084182410,1.58488271
"SALUDA MEDICAL, INC. CDI USPROHEXCLQIB",SLD,294841,252023810,.11698934
PLS GROUP LTD ORDINARY,PLS,410763608,3225946768,12.73311798
`;

describe("parseReportIndex", () => {
  test("keeps the highest version of each day, newest first, with the file URL", () => {
    const files = parseReportIndex([
      { date: 20260427, version: "001" },
      { date: 20260428, version: "001" },
      { date: 20260427, version: "002" },
      { date: "bad", version: "001" },
    ]);
    expect(files.map((file) => file.date)).toEqual(["2026-04-28", "2026-04-27"]);
    expect(files[1]!.url).toBe("https://download.asic.gov.au/short-selling/RR20260427-002-SSDailyAggShortPos.csv");
    expect(() => parseReportIndex({})).toThrow(/not recognised/);
  });
});

describe("parseShortCsv", () => {
  test("reads quoted names and leading-dot percentages; a changed header is an error", () => {
    const day = parseShortCsv(CSV, "2026-10-02");
    expect(day.rows.map((row) => row.code)).toEqual(["BHP", "SLD", "PLS"]);
    expect(day.rows[1]).toMatchObject({ product: "SALUDA MEDICAL, INC. CDI USPROHEXCLQIB", percent: 0.11698934 });
    expect(() => parseShortCsv("Code,Value\nBHP,1\n", "2026-10-02")).toThrow(/not recognised/);
  });

  test("a day without the code is a gap, not zero", () => {
    const day1 = parseShortCsv(CSV, "2026-10-02");
    const day0 = parseShortCsv(CSV.replace(/^PLS.*$/m, ""), "2026-10-01");
    expect(historyFor([day0, day1], "PLS")).toEqual([
      { date: "2026-10-02", percent: 12.73311798, shortPositions: 410763608 },
      { date: "2026-10-01", percent: null, shortPositions: null },
    ]);
  });
});

describe("selectHistoryFiles", () => {
  const index: ReportFile[] = Array.from({ length: 400 }, (_, offset) => {
    const date = new Date(Date.UTC(2026, 9, 2) - offset * 86_400_000).toISOString().slice(0, 10);
    return { date, url: date };
  }).filter((file) => ![0, 6].includes(new Date(`${file.date}T00:00:00Z`).getUTCDay()));

  test("every day for a month or quarter, about one a week for a year", () => {
    expect(selectHistoryFiles(index, "1M").length).toBeGreaterThanOrEqual(21);
    expect(selectHistoryFiles(index, "1M").length).toBeLessThanOrEqual(24);
    const year = selectHistoryFiles(index, "1Y");
    expect(year.length).toBeGreaterThanOrEqual(50);
    expect(year.length).toBeLessThanOrEqual(54);
    expect(year[0]!.date).toBe("2026-10-02");
  });
});

describe("reportedSeries", () => {
  test("oldest first, with unreported days as gaps", () => {
    expect(reportedSeries([
      { date: "2026-10-02", percent: 1.5, shortPositions: 10 },
      { date: "2026-10-01", percent: null, shortPositions: null },
      { date: "2026-09-30", percent: 1.2, shortPositions: 8 },
    ])).toEqual([
      { date: "2026-09-30", value: 1.2 },
      { date: "2026-10-01", value: null },
      { date: "2026-10-02", value: 1.5 },
    ]);
  });
});

describe("defaultHistoryRow", () => {
  test("opens on the newest reported day, not a newer day without a report", () => {
    const rows = [
      { date: "2026-10-06", percent: null, shortPositions: null },
      { date: "2026-10-03", percent: 1.2, shortPositions: 100 },
      { date: "2026-10-02", percent: 1.1, shortPositions: 90 },
    ];
    expect(defaultHistoryRow(rows, null)?.date).toBe("2026-10-03");
    expect(defaultHistoryRow(rows, "2026-10-06")?.date).toBe("2026-10-06");
    expect(defaultHistoryRow(rows, "2025-01-01")?.date).toBe("2026-10-03");
    expect(defaultHistoryRow([], null)).toBeNull();
  });
});

describe("weekChange and productName", () => {
  test("a product missing from last week's report is new, not a jump from zero", () => {
    const before = new Map([["BHP", 1.5]]);
    expect(weekChange(1.75, before, "BHP")).toBeCloseTo(0.25, 9);
    expect(weekChange(13.11, before, "BCOM")).toBe("new");
    expect(weekChange(13.11, null, "BCOM")).toBeNull();
    expect(productName("GBLX BLOOMBERG C ETF ETF UNITS")).toBe("GBLX BLOOMBERG C ETF");
    expect(productName("BETASHARES NASDAQ ETF UNITS")).toBe("BETASHARES NASDAQ ETF");
    expect(productName("SOME TRUST UNITS")).toBe("SOME TRUST");
    expect(productName("BHP GROUP LIMITED ORDINARY")).toBe("BHP GROUP LIMITED");
  });
});
