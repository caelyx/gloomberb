import { describe, expect, test } from "bun:test";
import type { RbaSeries } from "../rba/model";
import type { IbContract, IbStrip } from "./model";
import { moveOddsText } from "./model";
import { bpText, contractLabel, meetingLabel, rbapView, stepsText } from "./view";

const MEETINGS = ["2026-09-29", "2026-11-03", "2026-12-08"];

function contract(month: string, rate: number, extra: Partial<IbContract> = {}): IbContract {
  return { symbol: `IB${month}`, month, settlement: 100 - rate, last: null, lastTradeOn: null, bid: null, ask: null, volume: 0, ...extra };
}

function f1(target: Array<[string, number]>, cash: Array<[string, number]>): Map<string, RbaSeries> {
  const series = (id: string, points: Array<[string, number]>): [string, RbaSeries] => [id, { id, title: id, units: "Per cent", points: points.map(([date, value]) => ({ date, value })) }];
  return new Map([series("FIRMMCRTD", target), series("FIRMMCRID", cash)]);
}

// The cash rate runs 2 bp under the target; the market prices a cut in November and a hold in December.
const strip: IbStrip = {
  settledOn: "2026-10-09",
  contracts: [
    contract("2026-10", 4.58, { last: 95.42, lastTradeOn: "2026-10-09", volume: 120 }),
    contract("2026-11", (3 * 4.58 + 27 * 4.33) / 30),
    contract("2026-12", 4.33),
    contract("2027-01", 4.33),
  ],
};
const table = f1([["2026-09-30", 4.6], ["2026-10-09", 4.6]], [["2026-09-01", 4.35], ["2026-10-09", 4.58]]);

describe("rbapView", () => {
  test("shows the path on the target basis and the contracts as cash rates", () => {
    const view = rbapView({ strip, f1: table, lookbacks: [] }, "2026-10-10", MEETINGS);
    expect(view).toMatchObject({ target: 4.6, cashRate: 4.58, startFromFutures: false });
    expect(view.spread).toBeCloseTo(-0.02, 10);
    expect(view.meetings.map((row) => row.date)).toEqual(["2026-11-03", "2026-12-08"]);
    expect(view.meetings[0]!.rate).toBeCloseTo(4.35, 10);
    expect(view.meetings[0]!.move).toBeCloseTo(-0.25, 10);
    expect(view.meetings[1]!.cumulative).toBeCloseTo(-0.25, 10);
    expect(view.contracts[0]).toMatchObject({ label: "Oct 2026", traded: true });
    expect(view.contracts[0]!.rate).toBeCloseTo(4.58, 10);
    expect(view.contracts[1]!.traded).toBe(false);
    // A trade after the settlement day (during the next session) counts as traded.
    const later = rbapView({ strip: { ...strip, contracts: [contract("2026-10", 4.58, { last: 95.42, lastTradeOn: "2026-10-12" })] }, f1: table, lookbacks: [] }, "2026-10-12", MEETINGS);
    expect(later.contracts[0]!.traded).toBe(true);
  });

  test("measures the spread on one day, so a target that has just moved does not shift the path", () => {
    // The new target is in F1 for the 10th; the overnight rate is published a day behind.
    const lagging = f1([["2026-09-30", 4.6], ["2026-10-10", 4.85]], [["2026-10-09", 4.6]]);
    const view = rbapView({ strip, f1: lagging, lookbacks: [] }, "2026-10-10", MEETINGS);
    expect(view.spread).toBe(0);
    expect(view.target).toBe(4.85);
    // November is split from a 4.85 start: (avg × 30 − 4.85 × 3) / 27.
    const november = (3 * 4.58 + 27 * 4.33) / 30;
    expect(view.meetings[0]!.move).toBeCloseTo((november * 30 - 4.85 * 3) / 27 - 4.85, 10);
  });

  test("prices estimated meetings past the published schedule, and marks them", () => {
    // Only 2025 is published here, so this year's meetings are estimated from it, as far as the strip runs (January).
    const view = rbapView({ strip, f1: table, lookbacks: [] }, "2026-10-10", ["2025-11-04", "2025-12-09"]);
    expect(view.meetings.map((row) => [row.date, row.estimated])).toEqual([["2026-11-03", true], ["2026-12-08", true]]);
    expect(view.meetings[0]!.rate).toBeCloseTo(4.35, 10);
    expect(rbapView({ strip, f1: table, lookbacks: [] }, "2026-10-10", MEETINGS).meetings.every((row) => !row.estimated)).toBe(true);
  });

  test("a decision F1 does not show yet stays on its own meeting, not the next", () => {
    // 4 Nov: the 3 Nov cut has taken effect, but F1 still ends on the 3rd at 4.60.
    const behind = f1([["2026-09-30", 4.6], ["2026-11-03", 4.6]], [["2026-11-03", 4.58]]);
    const view = rbapView({ strip, f1: behind, lookbacks: [] }, "2026-11-04", MEETINGS);
    expect(view.meetings.map((row) => row.date)).toEqual(["2026-11-03", "2026-12-08"]);
    expect(view.meetings[0]!.move).toBeCloseTo(-0.25, 10);
    expect(view.meetings[1]!.move).toBeCloseTo(0, 10);
    expect(view.ratesAsOf).toBe("2026-11-03");
  });

  test("without F1, a meeting in the front month cannot be anchored, so no path is priced", () => {
    const view = rbapView({ strip, f1: null, lookbacks: [] }, "2026-11-01", MEETINGS);
    expect(view.meetings).toEqual([]);
    expect(view.unanchored).toBe(true);
    expect(view.contracts).toHaveLength(4);
  });

  test("starts from the front contract when the cash rate is unavailable", () => {
    const view = rbapView({ strip, f1: null, lookbacks: [] }, "2026-10-10", MEETINGS);
    expect(view).toMatchObject({ target: null, cashRate: null, spread: 0, startFromFutures: true });
    expect(view.meetings[0]!.move).toBeCloseTo(-0.25, 10);
  });

  test("prices a look-back from its own day and keeps the meetings still to come", () => {
    // A month ago: September's meeting not yet held, the cash rate 4.35 (target 4.35), and the market pricing a hike to 4.60 and nothing more.
    const old = [contract("2026-09", 4.35 + (1 / 30) * 0.25), contract("2026-10", 4.6), contract("2026-11", 4.6), contract("2026-12", 4.6), contract("2027-01", 4.6)];
    const tableThen = f1([["2026-09-01", 4.35], ["2026-09-30", 4.6], ["2026-10-09", 4.6]], [["2026-09-01", 4.35], ["2026-10-09", 4.58]]);
    const view = rbapView({ strip, f1: tableThen, lookbacks: [{ label: "1M", settledOn: "2026-09-09", contracts: old }] }, "2026-10-10", MEETINGS);
    const [ghost] = view.ghosts;
    expect(ghost).toMatchObject({ label: "1M", settledOn: "2026-09-09" });
    expect(ghost!.points.map((point) => point.date)).toEqual(["2026-11-03", "2026-12-08"]);
    // No spread a month ago (cash rate = target), so 4.60 on the target basis.
    expect(ghost!.points[0]!.rate).toBeCloseTo(4.6, 10);
    expect(ghost!.points.every((point) => point.estimated === false)).toBe(true);
  });
});

describe("formatting", () => {
  test("basis points and contract months", () => {
    expect(bpText(-0.25)).toBe("-25 bp");
    expect(bpText(0.0004)).toBe("0 bp");
    expect(bpText(0.075)).toBe("+8 bp");
    expect(bpText(null)).toBe("—");
    expect(contractLabel("2027-01")).toBe("Jan 2027");
    expect(stepsText(0.23)).toBe("+0.92");
    expect(stepsText(-0.0001)).toBe("0.00");
    expect(bpText(-0.0031, 1)).toBe("-0.3 bp");
    expect(bpText(0.0004, 1)).toBe("0.0 bp");
    expect(meetingLabel("2028-02-08", true)).toBe("~Feb '28");
  });

  test("a priced move is in basis points and agrees with its odds of a 25 bp step", () => {
    // 0.003 percentage points: 0.3 bp, not 0.3%; 0.3 / 25 is about 1%.
    expect(bpText(-0.003, 1)).toBe("-0.3 bp");
    expect(moveOddsText(-0.003)).toBe("1% cut");
    expect(bpText(0.072, 1)).toBe("+7.2 bp");
    expect(moveOddsText(0.072)).toBe("29% hike");
  });
});
