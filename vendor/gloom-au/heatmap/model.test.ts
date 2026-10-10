import { describe, expect, test } from "bun:test";
import scan from "./fixtures/tradingview-xjo.json";
import { sectorForIndustryGroup } from "./gics";
import { canGroupBySector, capWeightedMove, parseIndexScan, rankByMarketCap, sectorIndexAssets, summarizeSectors, type HeatmapAsset } from "./model";

describe("parseIndexScan", () => {
  test("reads every ASX 200 member of a live scan and marks the fifty ASX 50 members", () => {
    const members = parseIndexScan(scan);
    expect(members).toHaveLength(199);
    expect(members.filter((member) => member.inAsx50)).toHaveLength(50);
    expect(members.find((member) => member.code === "CSL")).toEqual({ code: "CSL", name: "CSL Limited", marketCap: 85534576230, inAsx50: true });
  });

  test("drops rows that are not ASX 200 members or not ASX listings; an unknown shape is an error", () => {
    const rows = [
      { s: "ASX:AAA", d: ["AAA", "Not in the index", 1e9, [{ proname: "ASX:XAO" }]] },
      { s: "NZX:AIR", d: ["AIR", "Wrong exchange", 1e9, [{ proname: "ASX:XJO" }]] },
      { s: "ASX:BBB", d: ["BBB", "Member", null, [{ proname: "ASX:XJO" }]] },
      null,
    ];
    expect(parseIndexScan({ data: rows })).toEqual([{ code: "BBB", name: "Member", marketCap: null, inAsx50: false }]);
    expect(() => parseIndexScan({ error: "blocked" })).toThrow();
  });
});

describe("sectorForIndustryGroup", () => {
  test("maps the directory's industry groups to the eleven sectors", () => {
    expect(sectorForIndustryGroup("Banks")).toBe("Financials");
    expect(sectorForIndustryGroup("Equity Real Estate Investment Trusts (REITs)")).toBe("Real Estate");
    expect(sectorForIndustryGroup("Pharmaceuticals, Biotechnology & Life Sciences")).toBe("Health Care");
    expect(sectorForIndustryGroup("Class Pend")).toBeNull();
  });
});

describe("rankByMarketCap", () => {
  test("largest companies with a sector, funds left out, a company under two codes once", () => {
    const listings = [
      { code: "BHP", name: "BHP GROUP LIMITED", industryGroup: "Materials", marketCap: 300e9 },
      { code: "VAS", name: "VANGUARD AUSTRALIAN SHARES", industryGroup: null, marketCap: 20e9 },
      { code: "NWSLV", name: "NEWS CORPORATION", industryGroup: "Media & Entertainment", marketCap: 24e9 },
      { code: "NWS", name: "NEWS CORPORATION", industryGroup: "Media & Entertainment", marketCap: 24e9 },
      { code: "TLS", name: "TELSTRA", industryGroup: "Telecommunication Services", marketCap: 54e9 },
      { code: "XYZ", name: "BLOCK", industryGroup: "Financial Services", marketCap: null },
    ];
    expect(rankByMarketCap(listings, 3).map((company) => company.code)).toEqual(["BHP", "TLS", "NWS"]);
  });
});

const asset = (label: string, sector: HeatmapAsset["sector"], size: number | null, changePercent: number | null): HeatmapAsset => ({
  symbol: `${label}.AX`, label, name: label, price: 1, changePercent, size, sector, industryGroup: null, lastUpdated: null,
});

describe("sector arithmetic", () => {
  const board = [
    asset("BHP", "Materials", 300, 2),
    asset("RIO", "Materials", 100, -2),
    asset("CBA", "Financials", 300, 1),
    asset("NEW", null, 50, null),
  ];

  test("moves are weighted by market cap, ignoring names without a move", () => {
    expect(capWeightedMove(board)).toBeCloseTo((600 - 200 + 300) / 700, 9);
    expect(capWeightedMove([asset("X", null, 10, null)])).toBeNull();
  });

  test("sectors largest first, unclassified last", () => {
    const sectors = summarizeSectors(board);
    expect(sectors.map((sector) => sector.sector)).toEqual(["Materials", "Financials", null]);
    expect(sectors[0]).toMatchObject({ size: 400, move: 1, up: 1, down: 1 });
  });

  test("a board grouped by sector needs two sectors carrying most of its weight", () => {
    expect(canGroupBySector(board)).toBe(true);
    expect(canGroupBySector([asset("A", "Energy", 1, 0), asset("B", null, 100, 0)])).toBe(false);
    expect(canGroupBySector([asset("A", "Energy", 1, 0), asset("B", "Energy", 1, 0)])).toBe(false);
  });

  test("sector index tiles are sized by their companies' market cap, or null without it", () => {
    const quotes = new Map([["^AXFJ", { name: null, price: 9000, changePercent: 0.5, marketCap: null, lastUpdated: 1 }], ["^AXEJ", { name: null, price: 10000, changePercent: -1, marketCap: null, lastUpdated: 2 }]]);
    const ranked = [
      { code: "CBA", name: "CBA", industryGroup: "Banks", marketCap: 300 },
      { code: "MQG", name: "MQG", industryGroup: "Financial Services", marketCap: 100 },
      { code: "WDS", name: "WDS", industryGroup: "Energy", marketCap: 60 },
    ];
    expect(sectorIndexAssets(quotes, ranked).map((tile) => [tile.symbol, tile.sector, tile.size])).toEqual([["^AXEJ", "Energy", 60], ["^AXFJ", "Financials", 400]]);
    expect(sectorIndexAssets(quotes, null).map((tile) => tile.size)).toEqual([null, null]);
  });
});
