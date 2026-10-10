import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/ib-futures.json";
import { contractMonth, impliedPath, meetingSchedule, monthAverages, moveOddsText, nearestDate, parseIbFutures, type IbContract } from "./model";

function contract(month: string, rate: number): IbContract {
  return { symbol: `IB${month}`, month, settlement: 100 - rate, last: null, lastTradeOn: null, bid: null, ask: null, volume: 0 };
}

const averages = (entries: Array<[string, number]>) => monthAverages(entries.map(([month, rate]) => contract(month, rate)));

describe("contractMonth", () => {
  test("reads the futures month code and year", () => {
    expect(contractMonth("IBV2026")).toBe("2026-10");
    expect(contractMonth("IBF2027")).toBe("2027-01");
    expect(contractMonth("IBH2028")).toBe("2028-03");
    expect(contractMonth("IBA2026")).toBeNull();
    expect(contractMonth("YTM2026")).toBeNull();
  });
});

describe("parseIbFutures", () => {
  test("reads ASX's strip of 30-day interbank cash rate futures", () => {
    const strip = parseIbFutures(fixture);
    expect(strip.settledOn).toBe("2026-10-09");
    expect(strip.contracts).toHaveLength(18);
    expect(strip.contracts[0]).toEqual({
      symbol: "IBV2026", month: "2026-10", settlement: 95.405, last: 95.4, lastTradeOn: "2026-10-09", bid: 95.4, ask: 95.405, volume: 1510,
    });
    // A contract that has never traded still settles.
    expect(strip.contracts.find((entry) => entry.symbol === "IBM2027")).toMatchObject({ settlement: 95.135, last: null, lastTradeOn: null, bid: null });
    expect(strip.contracts.map((entry) => entry.month)).toEqual([...strip.contracts.map((entry) => entry.month)].sort());
  });

  test("skips malformed contracts and rejects a response with none", () => {
    const strip = parseIbFutures({ data: { items: [
      { symbol: "IBV2026", pricePreviousSettlement: 95.4, datePreviousSettlement: "2026-10-09" },
      { symbol: "IBX2026", pricePreviousSettlement: "95.3" },
      { symbol: "nonsense", pricePreviousSettlement: 95.3 },
      { symbol: "IBZ2026", pricePreviousSettlement: 0 },
    ] } });
    expect(strip.contracts.map((entry) => entry.symbol)).toEqual(["IBV2026"]);
    expect(() => parseIbFutures({ data: { items: [] } })).toThrow(/no cash rate futures/);
    expect(() => parseIbFutures({ error: { code: 400 } })).toThrow(/not recognised/);
    expect(() => parseIbFutures(null)).toThrow(/not recognised/);
  });
});

describe("impliedPath", () => {
  const meetings = ["2026-09-29", "2026-11-03", "2026-12-08", "2027-02-09"];

  test("unwinds each upcoming meeting from the month averages", () => {
    // November: 3 days at 4.60, then 27 at 4.35.
    const path = impliedPath(averages([
      ["2026-10", 4.6], ["2026-11", (3 * 4.6 + 27 * 4.35) / 30], ["2026-12", 4.35], ["2027-01", 4.35], ["2027-02", 4.3], ["2027-03", 4.1],
    ]), meetings, 4.6, "2026-10-10");
    expect(path.map((meeting) => meeting.date)).toEqual(["2026-11-03", "2026-12-08", "2027-02-09"]);
    const [nov, dec, feb] = path;
    // December holds a meeting, so November's average is split by day.
    expect(nov).toMatchObject({ effective: "2026-11-04", pre: 4.6, method: "weighted" });
    expect(nov!.post).toBeCloseTo(4.35, 10);
    expect(nov!.move).toBeCloseTo(-0.25, 10);
    // January has no meeting: its average is the rate after December's.
    expect(dec).toMatchObject({ effective: "2026-12-09", method: "month" });
    expect(dec!.post).toBeCloseTo(4.35, 10);
    expect(dec!.move).toBeCloseTo(0, 10);
    expect(feb!.post).toBeCloseTo(4.1, 10);
    expect(feb!.cumulative).toBeCloseTo(-0.5, 10);
  });

  test("a meeting effective on the 1st takes that month's average", () => {
    const path = impliedPath(averages([["2027-03", 4.1], ["2027-04", 3.85], ["2027-05", 3.8]]), ["2027-03-31", "2027-05-04"], 4.1, "2027-03-01");
    expect(path[0]).toMatchObject({ effective: "2027-04-01", method: "month" });
    expect(path[0]!.post).toBeCloseTo(3.85, 10);
  });

  test("stops at the first meeting the strip cannot price", () => {
    const path = impliedPath(averages([["2026-11", 4.6], ["2026-12", 4.6]]), meetings, 4.6, "2026-10-10");
    // November splits by day (December has a meeting); December needs January, which is missing, so it splits too.
    expect(path.map((meeting) => meeting.date)).toEqual(["2026-11-03", "2026-12-08"]);
    expect(impliedPath(averages([]), meetings, 4.6, "2026-10-10")).toEqual([]);
  });

  test("a split with one day left in the month", () => {
    // Effective on the 31st: 30 days at 4.60, one at the new rate.
    const path = impliedPath(averages([["2027-03", (30 * 4.6 + 4.35) / 31], ["2027-05", 4.35]]), ["2027-03-30", "2027-04-27"], 4.6, "2027-03-01");
    expect(path[0]).toMatchObject({ effective: "2027-03-31", method: "weighted" });
    expect(path[0]!.post).toBeCloseTo(4.35, 8);
  });

  test("a decision due today is still upcoming", () => {
    const path = impliedPath(averages([["2026-11", 4.6], ["2026-12", 4.6], ["2027-01", 4.6]]), meetings, 4.6, "2026-11-03");
    expect(path[0]?.date).toBe("2026-11-03");
  });
});

describe("moveOddsText", () => {
  test("reads a move as two-outcome odds of 25 bp steps", () => {
    expect(moveOddsText(-0.155)).toBe("62% cut");
    expect(moveOddsText(0.25)).toBe("100% hike");
    expect(moveOddsText(0.3)).toBe("120% hike");
    expect(moveOddsText(0.0004)).toBe("0%");
    expect(moveOddsText(null)).toBe("—");
  });
});

describe("nearestDate", () => {
  test("finds the closest held date within the tolerance, earlier first on a tie", () => {
    const held = new Set(["2026-09-08", "2026-09-12"]);
    expect(nearestDate("2026-09-10", (date) => held.has(date))).toBe("2026-09-08");
    expect(nearestDate("2026-09-11", (date) => held.has(date))).toBe("2026-09-12");
    expect(nearestDate("2026-09-20", (date) => held.has(date))).toBeNull();
  });
});

describe("meetingSchedule", () => {
  const confirmed = ["2026-11-03", "2026-12-08", "2027-02-09", "2027-03-23", "2027-05-04", "2027-12-14"];

  test("estimates later meetings from the last confirmed year, a week short of a year on", () => {
    const schedule = meetingSchedule(confirmed, "2028-03");
    expect(schedule.filter((entry) => !entry.estimated).map((entry) => entry.date)).toEqual(confirmed);
    expect(schedule.filter((entry) => entry.estimated).map((entry) => entry.date)).toEqual(["2028-02-08", "2028-03-21"]);
    // The board decides on Tuesdays; 364 days keeps the weekday.
    for (const entry of schedule) expect(new Date(`${entry.date}T00:00:00Z`).getUTCDay()).toBe(2);
  });

  test("runs year after year as far as the strip, and not at all within confirmed years", () => {
    expect(meetingSchedule(confirmed, "2027-12").some((entry) => entry.estimated)).toBe(false);
    const far = meetingSchedule(confirmed, "2029-02").filter((entry) => entry.estimated).map((entry) => entry.date);
    expect(far).toEqual(["2028-02-08", "2028-03-21", "2028-05-02", "2028-12-12", "2029-02-06"]);
    expect(meetingSchedule([], "2028-03")).toEqual([]);
    expect(meetingSchedule(confirmed, "2026-06").every((entry) => !entry.estimated)).toBe(true);
  });
});
