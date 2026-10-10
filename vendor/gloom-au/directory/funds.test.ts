import { describe, expect, test } from "bun:test";
import { parseTradableFunds } from "./funds";

describe("parseTradableFunds", () => {
  test("keeps ASX-listed funds (TYPE 3) and drops shares and other venues", () => {
    const text = "H|CXACODE|DESC|ISIN|CURR|MIC|RLS|TICK|ALLOWONMKT|ALLOWOFFMKT|TYPE|INSTRUMENTSUBTYPE\n"
      + "D|IOZ|ISHAUS200 ETF UNITS [IOZ]|AU000000IOZ4|AUD|XASX|1|AUDASX1|1|1|3|7\n"
      + "D|MGF|MAGELLAN GLOBAL FUND [MGF]|AU0000000MGF|AUD|XASX|1|AUDASX1|1|1|3|36\n"
      + "D|BHP|BHP GROUP FPO [BHP]|AU000000BHP4|AUD|XASX|1|AUDASX1|1|1|1|1\n"
      + "D|ZZZ|OTHER VENUE [ZZZ]|AU0000000ZZZ|AUD|CHIA|1|AUDASX1|1|1|3|7\n";
    expect(parseTradableFunds(text)).toEqual([
      { code: "IOZ", name: "ISHAUS200 ETF", industryGroup: "ETF", listedOn: null, marketCap: null },
      { code: "MGF", name: "MAGELLAN GLOBAL FUND", industryGroup: "Fund", listedOn: null, marketCap: null },
    ]);
    expect(() => parseTradableFunds("<html>")).toThrow(/not recognised/);
  });
});
