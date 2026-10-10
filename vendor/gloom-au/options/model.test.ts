import { describe, expect, test } from "bun:test";
import { buildChain, expirySeconds, parseExpiryGroupsResponse, parseOptionsOverview } from "./model";

const payload = await Bun.file(new URL("./fixtures/cba.json", import.meta.url)).json();

describe("parseOptionsOverview", () => {
  const overview = parseOptionsOverview(payload);
  const first = overview.first!;

  test("keeps American series and drops the European twins listed a cent above", () => {
    expect(first.calls.map((contract) => contract.strike)).toEqual([92, 148, 150, 162]);
    expect(first.puts.map((contract) => contract.strike)).toEqual([92, 148, 150, 162]);
  });

  test("lists every expiry, in host seconds, including the one it carries", () => {
    const expiry = expirySeconds("2026-10-15")!;
    expect(new Date(expiry * 1000).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(first.expiration).toBe(expiry);
    expect(overview.expirations).toContain(expiry);
    expect(overview.expirations).toContain(expirySeconds("2026-10-22")!);
    expect(overview.expirations.length).toBeGreaterThan(5);
    expect([...overview.expirations].sort((a, b) => a - b)).toEqual(overview.expirations);
  });

  test("prices are rounded, in-the-money follows the underlying, and the chain says it is delayed", () => {
    const call148 = first.calls.find((contract) => contract.strike === 148)!;
    expect(call148).toMatchObject({ currency: "AUD", inTheMoney: true });
    expect(first.puts.find((contract) => contract.strike === 162)!.inTheMoney).toBe(true);
    expect(first.calls.find((contract) => contract.strike === 150)!.inTheMoney).toBe(false);
    for (const contract of [...first.calls, ...first.puts]) {
      expect(Math.round(contract.ask * 10_000) / 10_000).toBe(contract.ask);
    }
    expect(buildChain("CBA.AX", overview.expirations, first)).toMatchObject({ dataSource: "delayed", delayMinutes: 20, underlyingSymbol: "CBA.AX" });
  });

  test("a fund with no series has no first expiry; a malformed body is an error", () => {
    const empty = parseOptionsOverview({ data: { datesAvailable: { monthly: [] }, expiryGroups: { items: [] }, underlyingAsset: {} } });
    expect(empty.first).toBeNull();
    expect(empty.expirations).toEqual([]);
    expect(() => parseOptionsOverview({ error: { code: 400 } })).toThrow(/not recognised/);
  });
});

describe("parseExpiryGroupsResponse", () => {
  test("reads the series of a requested expiry", () => {
    const groups = parseExpiryGroupsResponse({ data: { items: payload.data.expiryGroups.items } }, 148.12);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.calls.length).toBe(4);
    expect(() => parseExpiryGroupsResponse({ data: {} }, null)).toThrow(/not recognised/);
  });
});
