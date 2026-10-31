import { RBA_DECISION_DATES, valueOnOrBefore, type RbaSeries } from "../rba/model";
import type { Lookback, RbapLoad } from "./client";
import { impliedPath, meetingSchedule, monthAverages, moveSteps, type IbContract, type IbStrip } from "./model";

export interface PathRow {
  date: string;
  effective: string;
  /** The implied cash rate target after the meeting, in percent. */
  rate: number;
  /** Percentage points, at this meeting and since today. */
  move: number;
  cumulative: number;
  method: "month" | "weighted";
  /** The RBA has not published this date: projected from its last published year. */
  estimated: boolean;
}

export interface ContractRow {
  symbol: string;
  month: string;
  label: string;
  /** The month's average cash rate the contract prices, in percent. */
  rate: number;
  settlement: number;
  last: number | null;
  lastTradeOn: string | null;
  bid: number | null;
  ask: number | null;
  volume: number;
  /** Traded on the settlement day; otherwise the settlement is ASX's own mark. */
  traded: boolean;
}

export interface GhostPath {
  label: string;
  settledOn: string;
  points: Array<{ date: string; rate: number; estimated: boolean }>;
}

export interface RbapView {
  settledOn: string;
  target: number | null;
  targetAsOf: string | null;
  cashRate: number | null;
  /** Cash rate less target: the contracts settle on the cash rate, the path is shown on the target. */
  spread: number;
  /** No cash rate to start from, so the front contract stands in for it. */
  startFromFutures: boolean;
  /**
   * No cash rate, and a meeting takes effect inside the front month, so
   * nothing gives the rate before it (the front contract averages both): no
   * path is priced rather than a false 0% at that meeting.
   */
  unanchored: boolean;
  /** The day F1's rates are as at; meetings from then on are on the path, even if their date has passed. */
  ratesAsOf: string | null;
  meetings: PathRow[];
  contracts: ContractRow[];
  ghosts: GhostPath[];
}

/** The footnote for the `~` on an estimated meeting date. */
export const ESTIMATED_NOTICE = "~ Estimated meeting date: the RBA has not yet published that year's schedule.";

/** Notices that qualify the path: estimated dates, F1 behind a decision, or no anchor at all. */
export function pathNotices(view: RbapView, today: string): string[] {
  const behind = view.meetings.find((row) => row.date < today);
  return [
    ...(view.meetings.some((row) => row.estimated) ? [ESTIMATED_NOTICE] : []),
    ...(behind && view.ratesAsOf ? [`The RBA's rates run to ${view.ratesAsOf}, so the ${behind.date} decision is shown as the futures price it, not as decided.`] : []),
    ...(view.unanchored ? ["Cash rate unavailable and a meeting takes effect this month, so the path cannot be priced; the contracts are still listed."] : []),
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2027-01` → `Jan 2027`. */
export function contractLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

/** A meeting as a chart label, `Nov '26`; `~Feb '28` for an estimated date. */
export function meetingLabel(date: string, estimated = false): string {
  return `${estimated ? "~" : ""}${MONTHS[Number(date.slice(5, 7)) - 1] ?? date.slice(5, 7)} '${date.slice(2, 4)}`;
}

/**
 * The target and overnight cash rate as at `date` (default latest). The spread
 * between them is taken on the overnight rate's own day, which F1 can publish
 * a day behind the target: on the day a new target applies, the latest of each
 * would differ by the decision itself. The rate the path starts from is the
 * target plus that spread.
 */
function rates(f1: Map<string, RbaSeries> | null, date: string | null) {
  const points = (id: string) => f1?.get(id)?.points ?? [];
  const at = (id: string, day: string | null) => (day ? valueOnOrBefore(points(id), day) : points(id).at(-1)) ?? null;
  const target = at("FIRMMCRTD", date);
  const cash = at("FIRMMCRID", date);
  const targetThen = cash ? valueOnOrBefore(points("FIRMMCRTD"), cash.date) : null;
  const spread = cash && targetThen ? cash.value - targetThen.value : 0;
  const start = target ? target.value + spread : cash?.value ?? null;
  return { target, cash, spread, start };
}

/** The path a strip prices, on the target basis. Null when there is nothing to start from. */
function pathFrom(contracts: ReadonlyArray<Pick<IbContract, "month" | "settlement">>, f1: Map<string, RbaSeries> | null, asOf: string | null, today: string, schedule: Schedule) {
  const averages = monthAverages(contracts);
  const { target, cash, spread, start: fromF1 } = rates(f1, asOf);
  // Without F1, this month's contract stands in (a cached strip can still list last month's).
  const front = contracts.find((entry) => entry.month >= today.slice(0, 7));
  const start = fromF1 ?? (front ? averages.get(front.month) ?? null : null);
  if (start == null) return null;
  // Meetings count from the day F1 is as at, so a decision it does not show yet is priced at its own meeting.
  const ratesAsOf = fromF1 == null ? null : target?.date ?? cash?.date ?? null;
  const from = ratesAsOf ?? today;
  const unanchored = fromF1 == null && !!front
    && schedule.dates.some((date) => date >= from && addDay(date).slice(0, 7) === front.month && !addDay(date).endsWith("-01"));
  if (unanchored) return { path: [], target, cash, spread, startFromFutures: true, unanchored, ratesAsOf };
  const path = impliedPath(averages, schedule.dates, start, from).map((meeting): PathRow => ({
    date: meeting.date, effective: meeting.effective, rate: meeting.post - spread, move: meeting.move, cumulative: meeting.cumulative, method: meeting.method,
    estimated: schedule.estimated.has(meeting.date),
  }));
  return { path, target, cash, spread, startFromFutures: fromF1 == null, unanchored, ratesAsOf };
}

function addDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

interface Schedule {
  dates: string[];
  estimated: ReadonlySet<string>;
}

function ghost(lookback: Lookback, f1: Map<string, RbaSeries> | null, firstMeeting: string, schedule: Schedule): GhostPath | null {
  // Priced from its own day, so a meeting held since then still links it to today's meetings.
  const priced = pathFrom(lookback.contracts, f1, lookback.settledOn, lookback.settledOn, schedule);
  const points = priced?.path.filter((row) => row.date >= firstMeeting).map((row) => ({ date: row.date, rate: row.rate, estimated: row.estimated })) ?? [];
  return points.length ? { label: lookback.label, settledOn: lookback.settledOn, points } : null;
}

/** `confirmed`: the RBA's published decision dates; later meetings the strip reaches are estimated from them. */
export function rbapView(data: Pick<RbapLoad, "strip" | "f1" | "lookbacks">, today: string, confirmed: readonly string[] = RBA_DECISION_DATES): RbapView {
  const strip: IbStrip = data.strip;
  const meetings = meetingSchedule(confirmed, strip.contracts.at(-1)?.month ?? today.slice(0, 7));
  const schedule: Schedule = { dates: meetings.map((entry) => entry.date), estimated: new Set(meetings.filter((entry) => entry.estimated).map((entry) => entry.date)) };
  const priced = pathFrom(strip.contracts, data.f1, null, today, schedule);
  return {
    settledOn: strip.settledOn,
    target: priced?.target?.value ?? null,
    targetAsOf: priced?.target?.date ?? null,
    cashRate: priced?.cash?.value ?? null,
    spread: priced?.spread ?? 0,
    startFromFutures: priced?.startFromFutures ?? true,
    unanchored: priced?.unanchored ?? false,
    ratesAsOf: priced?.ratesAsOf ?? null,
    meetings: priced?.path ?? [],
    contracts: strip.contracts.map((entry) => ({
      ...entry,
      label: contractLabel(entry.month),
      rate: 100 - entry.settlement,
      traded: !!entry.lastTradeOn && entry.lastTradeOn >= strip.settledOn,
    })),
    ghosts: data.lookbacks.map((lookback) => ghost(lookback, data.f1, priced?.path[0]?.date ?? today, schedule)).filter((entry): entry is GhostPath => entry !== null),
  };
}

export type HistoryMonths = "0M" | "1M" | "3M" | "6M";

/** The lead-in the path chart can show before the first meeting. */
export const HISTORY_MONTHS: ReadonlyArray<{ value: HistoryMonths; label: string }> = [
  { value: "0M", label: "None" },
  { value: "1M", label: "1 month" },
  { value: "3M", label: "3 months" },
  { value: "6M", label: "6 months" },
];

/** A persisted setting read back safely; anything unknown is 3 months. */
export function historyMonths(value: unknown): HistoryMonths {
  return HISTORY_MONTHS.some((option) => option.value === value) ? (value as HistoryMonths) : "3M";
}

/** `months` calendar months before an ISO date, clamped to the end of a shorter month. */
export function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

/**
 * The cash rate target over the `months` before `today`, as steps: the target
 * in force at the start, each change, and the latest observation. It ends where
 * F1 does, so a decision F1 does not show yet stays on the path, not here.
 */
export function targetHistory(f1: Map<string, RbaSeries> | null, today: string, months: HistoryMonths): Array<{ date: string; rate: number }> {
  if (months === "0M") return [];
  const points = f1?.get("FIRMMCRTD")?.points ?? [];
  const start = monthsBefore(today, Number(months.slice(0, -1)));
  const opening = valueOnOrBefore(points, start);
  const steps = opening ? [{ date: start, rate: opening.value }] : [];
  for (const point of points) {
    if (point.date <= start) continue;
    if (steps.at(-1)?.rate !== point.value) steps.push({ date: point.date, rate: point.value });
  }
  const latest = points.at(-1);
  if (latest && latest.date > start && steps.at(-1)?.date !== latest.date) steps.push({ date: latest.date, rate: latest.value });
  return steps;
}

/**
 * The target line on the path chart: the actual target (`history`), then, when
 * `showCurrent`, today's target held flat across the meetings, from where the
 * history ends (or from F1's day without history). Empty without a path.
 */
export function targetLine(
  view: Pick<RbapView, "target" | "targetAsOf"> & { meetings: ReadonlyArray<{ date: string }> },
  history: ReadonlyArray<{ date: string; rate: number }>,
  showCurrent: boolean,
): Array<{ date: string; rate: number }> {
  if (!view.meetings.length) return [];
  const line = [...history];
  if (!showCurrent || view.target == null) return line;
  if (!line.length && view.targetAsOf) line.push({ date: view.targetAsOf, rate: view.target });
  for (const meeting of view.meetings) {
    const last = line.at(-1);
    if (!last || meeting.date > last.date) line.push({ date: meeting.date, rate: view.target });
  }
  return line;
}

/**
 * A meeting's outcomes as 25 bp steps from today's target, the two-outcome
 * reading the odds use, carried to the level: the implied change since today
 * (`cumulative`, percentage points) splits between the whole steps either side
 * of it, so +0.09 is 64% no change and 36% one hike. Whole steps (to within
 * rounding) are certain.
 */
export function outcomeOdds(cumulative: number): Array<{ steps: number; probability: number }> {
  const steps = Math.round((cumulative / 0.25) * 1e9) / 1e9;
  const lower = Math.floor(steps);
  const upper = steps - lower;
  return upper === 0 ? [{ steps: lower, probability: 1 }] : [{ steps: lower, probability: 1 - upper }, { steps: lower + 1, probability: upper }];
}

export interface ProbabilityTable<T = PathRow> {
  /** Cash rate target levels in percent, 25 bp apart, from the lowest outcome to the highest. */
  levels: number[];
  /** Each meeting's odds of each level, aligned to `levels`. */
  rows: Array<{ meeting: T; odds: number[] }>;
}

/**
 * The odds of each target level after each meeting, like WIRP's probabilities.
 * Empty without the target: a path from the front contract is not on the
 * target's 25 bp grid.
 */
export function probabilityTable<T extends { cumulative: number }>(view: { target: number | null; meetings: readonly T[] }): ProbabilityTable<T> {
  const { target } = view;
  if (target == null || !view.meetings.length) return { levels: [], rows: [] };
  const outcomes = view.meetings.map((meeting) => ({ meeting, odds: outcomeOdds(meeting.cumulative) }));
  const all = outcomes.flatMap((entry) => entry.odds.map((odds) => odds.steps));
  const low = Math.min(...all);
  const steps = Array.from({ length: Math.max(...all) - low + 1 }, (_, index) => low + index);
  return {
    levels: steps.map((step) => Number((target + step * 0.25).toFixed(4))),
    rows: outcomes.map(({ meeting, odds }) => ({ meeting, odds: steps.map((step) => odds.find((entry) => entry.steps === step)?.probability ?? 0) })),
  };
}

/** A probability to one decimal, `64.0%`. */
export function probabilityText(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** Percentage points as signed basis points (`-25 bp`, `-0.3 bp`); a move that rounds to zero prints unsigned. */
export function bpText(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const bp = Number((value * 100).toFixed(digits)) || 0;
  return `${bp > 0 ? "+" : ""}${bp.toFixed(digits)} bp`;
}

/** Moves priced since today, in 25 bp steps: `-1.20`. */
export function stepsText(value: number | null): string {
  const steps = moveSteps(value);
  if (steps == null) return "—";
  const text = steps.toFixed(2);
  return /[1-9]/.test(text) ? `${steps > 0 ? "+" : ""}${text}` : "0.00";
}

export function priceText(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}
