import { describe, expect, test } from "bun:test";
import type { InstrumentSearchResult } from "gloomberb/types/instrument";
import { parsePredictiveSearch, type AsxCompany } from "./client";
import predictive from "./fixtures/predictive.json";
import { findAsxListings, rankAsxListings, type AsxListingSources } from "./search";

/** ASX predictive search captures (10 October 2026): "vanguard australian", and the codes VAS and VHY. */
const asx = (query: keyof typeof predictive) => parsePredictiveSearch(predictive[query]);

/** What the host's search returned for "vanguard australian" (10 October 2026), ASX and CXA lines alike. */
const hostVanguard: InstrumentSearchResult[] = [
  ["VAS", "Vanguard Australian Shares Index ETF", "ASX"],
  ["VHY", "Vanguard Australian Shares High Yield ETF", "ASX"],
  ["VAP", "Vanguard Australian Property Securities Index ETF", "ASX"],
  ["VAF", "Vanguard Australian Fixed Interest Index ETF", "ASX"],
  ["VAS", "Vanguard Australian Shares Index ETF", "CXA"],
  ["VAS", "Vanguard Australian Shares Index ETF", "XWBO"],
].map(([symbol, name, exchange]) => ({ providerId: "test", symbol: symbol!, name: name!, exchange: exchange!, type: "ETF" }));

function sources(over: Partial<AsxListingSources> = {}): AsxListingSources & { lookedUp: string[] } {
  const lookedUp: string[] = [];
  return {
    lookedUp,
    live: async () => asx("vanguard australian"),
    host: async () => hostVanguard,
    lookup: async (code) => {
      lookedUp.push(code);
      return code === "VAS" || code === "VHY" ? asx(code).find((row) => row.code === code) ?? null : null;
    },
    lists: async () => [],
    ...over,
  };
}

describe("findAsxListings", () => {
  test("ASX's five-row search misses VAS and VHY; merged with the host's, the largest funds lead", async () => {
    // The fixture shows the cause: five rows, alphabetical by name.
    expect(asx("vanguard australian").map((row) => row.code)).toEqual(["VACF", "VAF", "VFLT", "VGB", "VAP"]);
    const fake = sources();
    const found = await findAsxListings("vanguard australian", fake, new AbortController().signal);
    expect(found.map((row) => row.code)).toEqual(["VAS", "VHY", "VAF", "VAP", "VGB", "VACF"]);
    expect(found[0]).toMatchObject({ name: "Vanguard Australian Shares Index ETF", industryGroup: "ETF" });
    expect(found[0]?.marketCap).toBeGreaterThan(2e10);
    // Only listings ASX's search left out are looked up, once each, and the CXA line is the same listing.
    expect(fake.lookedUp).toEqual(["VAS", "VHY"]);
  });

  test("either search failing leaves the other's rows; both failing falls back to the lists", async () => {
    const signal = new AbortController().signal;
    const hostOnly = await findAsxListings("vanguard australian", sources({ live: async () => { throw new Error("down"); } }), signal);
    expect(hostOnly.map((row) => row.code)).toEqual(["VAS", "VHY", "VAP", "VAF"]);
    const asxOnly = await findAsxListings("vanguard australian", sources({ host: async () => { throw new Error("down"); } }), signal);
    expect(asxOnly.map((row) => row.code)).toEqual(["VAF", "VAP", "VGB", "VACF", "VFLT"]);
    const fund: AsxCompany = { code: "VAS", name: "V300AEQ ETF", industryGroup: "ETF", listedOn: null, marketCap: null };
    const lists = await findAsxListings("VAS", sources({ live: async () => [], host: async () => [], lists: async () => [fund] }), signal);
    expect(lists.map((row) => row.code)).toEqual(["VAS"]);
  });

  test("an aborted keystroke returns nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await findAsxListings("vanguard australian", sources(), controller.signal)).toEqual([]);
  });
});

describe("rankAsxListings", () => {
  test("an exact code beats a larger company; unknown sizes keep their order at the end", () => {
    const row = (code: string, marketCap: number | null): AsxCompany => ({ code, name: code, industryGroup: null, listedOn: null, marketCap });
    const ranked = rankAsxListings("bhp.ax", [row("BHPX", null), row("XYZ", null), row("RIO", 2e11), row("BHP", 1e9)]);
    expect(ranked.map((company) => company.code)).toEqual(["BHP", "RIO", "BHPX", "XYZ"]);
  });
});
