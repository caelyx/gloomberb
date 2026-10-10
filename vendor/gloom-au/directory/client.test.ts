import { describe, expect, test } from "bun:test";
import { parseAsxDirectoryCsv, searchAsxDirectory } from "./client";

// Trimmed copies of the two published layouts.
const DIRECTORY_CSV = `"ASX code","Company name","GICs industry group","Listing date","Market Cap"
"BHP","BHP GROUP LIMITED","Materials","13/08/1885",311025926144
"BHPX","BHP SOMETHING ""B"" LTD","Materials","01/02/2024",1000000
"VAS","VANGUARD AUSTRALIAN SHARES INDEX ETF","Not Applic","08/05/2009",
"CBA","COMMONWEALTH BANK OF AUSTRALIA.","Banks","12/09/1991",247674961920
`;

const LISTED_COMPANIES_CSV = `ASX listed companies as at Thu Oct 08 20:43:01 AEDT 2026

Company name,ASX code,GICS industry group
"1414 DEGREES LIMITED","14D","Capital Goods"
"29METALS LIMITED","29M","Materials"
`;

describe("parseAsxDirectoryCsv", () => {
  test("reads both ASX layouts by their header row", () => {
    const directory = parseAsxDirectoryCsv(DIRECTORY_CSV);
    expect(directory).toHaveLength(4);
    expect(directory[0]).toEqual({
      code: "BHP", name: "BHP GROUP LIMITED", industryGroup: "Materials", listedOn: "1885-08-13", marketCap: 311025926144,
    });
    expect(directory[1]!.name).toBe("BHP SOMETHING \"B\" LTD");
    expect(directory[2]).toMatchObject({ code: "VAS", industryGroup: null, marketCap: null });

    const listed = parseAsxDirectoryCsv(LISTED_COMPANIES_CSV);
    expect(listed.map((company) => company.code)).toEqual(["14D", "29M"]);
    expect(listed[0]).toMatchObject({ listedOn: null, marketCap: null });
  });

  test("an unrecognised or empty file is an error, not an empty directory", () => {
    expect(() => parseAsxDirectoryCsv("<html>maintenance</html>")).toThrow(/not recognised/);
    expect(() => parseAsxDirectoryCsv("\"ASX code\",\"Company name\"\n")).toThrow(/empty/);
  });
});

describe("searchAsxDirectory", () => {
  const directory = parseAsxDirectoryCsv(DIRECTORY_CSV);

  test("exact code, then code prefix, then names; bigger companies first within a tier", () => {
    expect(searchAsxDirectory(directory, "bhp").map((company) => company.code)).toEqual(["BHP", "BHPX"]);
    expect(searchAsxDirectory(directory, "VAS.AX").map((company) => company.code)).toEqual(["VAS"]);
    expect(searchAsxDirectory(directory, "commonwealth bank").map((company) => company.code)).toEqual(["CBA"]);
    expect(searchAsxDirectory(directory, "australia").map((company) => company.code)).toEqual(["CBA", "VAS"]);
  });
});

describe("parsePredictiveSearch", () => {
  test("keeps full fund names and types; an empty answer is no results", async () => {
    const { parsePredictiveSearch } = await import("./client");
    expect(parsePredictiveSearch({ data: { items: [
      { symbol: "VAS", issueType: "ETF", displayName: "VANGUARD AUSTRALIAN SHARES INDEX ETF", marketCap: 26886010000 },
      { symbol: "BHP", issueType: "CS", displayName: "BHP GROUP LIMITED" },
    ] } })).toEqual([
      { code: "VAS", name: "VANGUARD AUSTRALIAN SHARES INDEX ETF", industryGroup: "ETF", listedOn: null, marketCap: 26886010000 },
      { code: "BHP", name: "BHP GROUP LIMITED", industryGroup: null, listedOn: null, marketCap: null },
    ]);
    expect(parsePredictiveSearch({ data: {} })).toEqual([]);
  });
});
