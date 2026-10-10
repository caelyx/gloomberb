import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "gloomberb/utils";
import { fetchUsCurve } from "../rba/client";
import { parseTreasuryCsv, sessionOnOrBefore } from "./treasury";

const fixture = (year: number) => Bun.file(new URL(`../../test/fixtures/ust-${year}-sample.csv`, import.meta.url)).text();
const sessions = parseTreasuryCsv(await fixture(2026));

describe("parseTreasuryCsv on Treasury's file", () => {
  test("oldest first, with the tenors from one year out, read by column name", () => {
    expect(sessions.map((session) => session.date)).toEqual(
      ["2026-01-02", "2026-01-05", "2026-01-06", "2026-09-29", "2026-09-30", "2026-10-01"]);
    const sep30 = sessions.find((session) => session.date === "2026-09-30")!;
    expect(sep30.points.map((point) => point.tenor)).toEqual(["1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]);
    expect(sep30.points.find((point) => point.tenor === "10Y")?.yield).toBe(5.29);
  });
});

describe("sessionOnOrBefore", () => {
  test("a weekend or holiday takes the last session before it", () => {
    expect(sessionOnOrBefore(sessions, "2026-10-03")?.date).toBe("2026-10-01");
  });

  test("a session more than ten days back does not stand in for the date", () => {
    expect(sessionOnOrBefore(sessions, "2026-03-01")).toBeNull();
  });
});

describe("fetchUsCurve", () => {
  const requested: number[] = [];
  beforeAll(() => setHttpFetchTransport(async (url) => {
    const year = Number(/daily-treasury-rates\.csv\/(\d{4})/.exec(url)![1]);
    requested.push(year);
    return new Response(await fixture(year));
  }));
  afterEach(() => { requested.length = 0; });
  afterAll(() => setHttpFetchTransport(null));

  test("New Year's Day reaches back into last year's file", async () => {
    expect((await fetchUsCurve("2026-01-01")).date).toBe("2025-12-31");
    expect(requested).toEqual([2026, 2025]);
  });

  test("a date with a session in its own year reads one file", async () => {
    expect((await fetchUsCurve("2026-01-05")).date).toBe("2026-01-05");
    expect(requested).toEqual([2026]);
  });
});
