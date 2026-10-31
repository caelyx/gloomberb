import { describe, expect, test } from "bun:test";
import type { RbaSeries } from "../rba/model";
import type { IbContract, IbStrip } from "./model";
import { moveOddsText } from "./model";
import { bpText, contractLabel, historyMonths, meetingLabel, monthsBefore, outcomeOdds, probabilityTable, probabilityText, rbapView, stepsText, targetHistory, targetLine } from "./view";

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

describe("targetHistory", () => {
  const history = f1([["2026-03-31", 4.1], ["2026-04-01", 4.1], ["2026-05-06", 4.35], ["2026-05-07", 4.35], ["2026-09-30", 4.6], ["2026-10-09", 4.6]], []);

  test("starts at the target in force n months back, then steps at each change to the latest observation", () => {
    expect(targetHistory(history, "2026-10-10", "6M")).toEqual([
      { date: "2026-04-10", rate: 4.1 },
      { date: "2026-05-06", rate: 4.35 },
      { date: "2026-09-30", rate: 4.6 },
      { date: "2026-10-09", rate: 4.6 },
    ]);
    expect(targetHistory(history, "2026-10-10", "1M")).toEqual([
      { date: "2026-09-10", rate: 4.35 },
      { date: "2026-09-30", rate: 4.6 },
      { date: "2026-10-09", rate: 4.6 },
    ]);
  });

  test("no history at 0 months", () => {
    expect(targetHistory(history, "2026-10-10", "0M")).toEqual([]);
  });

  test("empty without F1 or any target before the start", () => {
    expect(targetHistory(null, "2026-10-10", "3M")).toEqual([]);
    expect(targetHistory(f1([["2026-10-09", 4.6]], []), "2026-10-10", "3M")).toEqual([{ date: "2026-10-09", rate: 4.6 }]);
    expect(targetHistory(f1([], []), "2026-10-10", "3M")).toEqual([]);
  });

  test("calendar months back, clamped to the shorter month; unknown settings fall back to 3 months", () => {
    expect(monthsBefore("2026-05-31", 3)).toBe("2026-02-28");
    expect(monthsBefore("2026-01-15", 1)).toBe("2025-12-15");
    expect(monthsBefore("2028-08-31", 6)).toBe("2028-02-29");
    expect(historyMonths("6M")).toBe("6M");
    expect(historyMonths("0M")).toBe("0M");
    expect(historyMonths("12M")).toBe("3M");
    expect(historyMonths(undefined)).toBe("3M");
  });
});

describe("targetLine", () => {
  const view = { target: 4.6, targetAsOf: "2026-10-09", meetings: [{ date: "2026-11-03" }, { date: "2026-12-08" }] };
  const history = [{ date: "2026-09-10", rate: 4.35 }, { date: "2026-09-30", rate: 4.6 }, { date: "2026-10-09", rate: 4.6 }];

  test("the actual target, then today's held flat across the meetings", () => {
    expect(targetLine(view, history, true)).toEqual([...history, { date: "2026-11-03", rate: 4.6 }, { date: "2026-12-08", rate: 4.6 }]);
  });

  test("without history the flat line starts where F1 is as at", () => {
    expect(targetLine(view, [], true)).toEqual([{ date: "2026-10-09", rate: 4.6 }, { date: "2026-11-03", rate: 4.6 }, { date: "2026-12-08", rate: 4.6 }]);
  });

  test("the flat part switched off leaves the history alone, or nothing", () => {
    expect(targetLine(view, history, false)).toEqual(history);
    expect(targetLine(view, [], false)).toEqual([]);
  });

  test("a meeting on the history's last day is not drawn twice; nothing without a path or a target", () => {
    const behind = { ...view, targetAsOf: "2026-11-03", meetings: [{ date: "2026-11-03" }, { date: "2026-12-08" }] };
    expect(targetLine(behind, [{ date: "2026-11-03", rate: 4.6 }], true).map((point) => point.date)).toEqual(["2026-11-03", "2026-12-08"]);
    expect(targetLine({ ...view, meetings: [] }, history, true)).toEqual([]);
    expect(targetLine({ ...view, target: null }, [], true)).toEqual([]);
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

describe("outcomeOdds", () => {
  test("splits a meeting between the two 25 bp steps either side of its implied level", () => {
    const odds = outcomeOdds(0.09);
    expect(odds.map((entry) => entry.steps)).toEqual([0, 1]);
    expect(odds[0]!.probability).toBeCloseTo(0.64, 10);
    expect(odds[1]!.probability).toBeCloseTo(0.36, 10);
    const cuts = outcomeOdds(-0.3);
    expect(cuts.map((entry) => entry.steps)).toEqual([-2, -1]);
    expect(cuts[0]!.probability).toBeCloseTo(0.2, 10);
    expect(cuts[1]!.probability).toBeCloseTo(0.8, 10);
  });

  test("a whole number of steps is certain, despite floating-point noise", () => {
    expect(outcomeOdds(0)).toEqual([{ steps: 0, probability: 1 }]);
    expect(outcomeOdds(0.1 + 0.2 + 0.45)).toEqual([{ steps: 3, probability: 1 }]);
    expect(outcomeOdds(-0.25 - 1e-12)).toEqual([{ steps: -1, probability: 1 }]);
  });

  test("printed to one decimal, as on WIRP", () => {
    expect([probabilityText(0.64), probabilityText(0.0004), probabilityText(1), probabilityText(null)]).toEqual(["64.0%", "0.0%", "100.0%", "—"]);
  });
});

describe("probabilityTable", () => {
  test("one column per 25 bp target level the meetings reach, odds aligned to them", () => {
    const view = rbapView({ strip, f1: table, lookbacks: [] }, "2026-10-10", MEETINGS);
    const { levels, rows } = probabilityTable(view);
    // Both meetings price a whole cut, so 4.35% is the only outcome.
    expect(levels).toEqual([4.35]);
    expect(rows.map((row) => row.meeting.date)).toEqual(["2026-11-03", "2026-12-08"]);
    expect(rows.map((row) => row.odds)).toEqual([[1], [1]]);
  });

  test("levels between the outcomes are filled in, at zero odds", () => {
    const view = { target: 4.6, meetings: [{ cumulative: 0.09 }, { cumulative: 0.6 }] };
    const { levels, rows } = probabilityTable(view);
    expect(levels).toEqual([4.6, 4.85, 5.1, 5.35]);
    expect(rows[0]!.odds.map((value) => Number(value.toFixed(4)))).toEqual([0.64, 0.36, 0, 0]);
    expect(rows[1]!.odds.map((value) => Number(value.toFixed(4)))).toEqual([0, 0, 0.6, 0.4]);
  });

  test("nothing without the cash rate target: the front contract's level is not on the target's 25 bp grid", () => {
    expect(probabilityTable({ target: null, meetings: [{ cumulative: 0.1 }] })).toEqual({ levels: [], rows: [] });
    expect(probabilityTable({ target: 4.6, meetings: [] })).toEqual({ levels: [], rows: [] });
  });
});
