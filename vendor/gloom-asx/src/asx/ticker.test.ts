import { describe, expect, test } from "bun:test";
import type { TickerRecord } from "gloomberb/types/ticker";
import { asxCodeForTicker, isAsxTicker } from "./ticker";

function ticker(symbol: string, exchange = ""): TickerRecord {
  return {
    metadata: {
      ticker: symbol, exchange, currency: "AUD", name: symbol,
      portfolios: [], watchlists: [], positions: [], custom: {}, tags: [],
    },
  };
}

describe("asxCodeForTicker", () => {
  test("recognises the ASX exchange in metadata", () => {
    expect(asxCodeForTicker(ticker("CBA", "ASX"))).toBe("CBA");
    expect(asxCodeForTicker(ticker("cba", "XASX"))).toBe("CBA");
  });

  test("recognises a Yahoo-style .AX suffix and strips it", () => {
    expect(asxCodeForTicker(ticker("CBA.AX"))).toBe("CBA");
    expect(asxCodeForTicker(ticker("CBA.AX", "NASDAQ"))).toBe("CBA");
  });

  test("recognises an exchange-qualified key", () => {
    expect(asxCodeForTicker(ticker("CBA:ASX"))).toBe("CBA");
  });

  test("rejects everything else", () => {
    expect(asxCodeForTicker(ticker("AAPL", "NASDAQ"))).toBeNull();
    expect(asxCodeForTicker(ticker("AAPL"))).toBeNull();
    expect(asxCodeForTicker(null)).toBeNull();
  });

  test("isAsxTicker mirrors the code lookup", () => {
    expect(isAsxTicker(ticker("BHP", "ASX"))).toBe(true);
    expect(isAsxTicker(ticker("BHP", "LSE"))).toBe(false);
  });
});
