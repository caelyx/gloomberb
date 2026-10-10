/*
 * The RBA path the ASX 30-day interbank cash rate futures price. Each contract
 * settles at 100 less the month's average interbank overnight cash rate, so a
 * contract's price gives the average rate the market expects for its month;
 * the board's decision dates split those averages into a rate after each
 * meeting. docs/rbap.md has the method and its limits.
 */

/** One listed contract, as at the last settlement. Prices are index points (100 less the rate). */
export interface IbContract {
  symbol: string;
  /** The calendar month it settles on, `2026-10`. */
  month: string;
  settlement: number;
  last: number | null;
  lastTradeOn: string | null;
  bid: number | null;
  ask: number | null;
  volume: number;
}

export interface IbStrip {
  /** The settlement day the prices are from. */
  settledOn: string;
  /** In month order. */
  contracts: IbContract[];
}

const MONTH_CODES = "FGHJKMNQUVXZ";

/** `IBV2026` → `2026-10`, from the futures month code; null for anything else. */
export function contractMonth(symbol: string): string | null {
  const match = /^IB([A-Z])(\d{4})$/.exec(symbol);
  const index = match ? MONTH_CODES.indexOf(match[1]!) : -1;
  return match && index >= 0 ? `${match[2]}-${String(index + 1).padStart(2, "0")}` : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function price(value: unknown): number | null {
  // Index points sit near 100 less the rate; anything far off is not a price.
  return typeof value === "number" && Number.isFinite(value) && value > 80 && value <= 110 ? value : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

/** ASX's futures strip (`derivatives/interest-rate/IB/futures`); contracts without a usable settlement are left out. */
export function parseIbFutures(json: unknown): IbStrip {
  const items = (json as { data?: { items?: unknown } } | null)?.data?.items;
  if (!Array.isArray(items)) throw new Error("Cash rate futures response not recognised");
  const contracts: IbContract[] = [];
  let settledOn = "";
  for (const item of items as Array<Record<string, unknown>>) {
    const symbol = typeof item?.symbol === "string" ? item.symbol : "";
    const month = contractMonth(symbol);
    const settlement = price(item?.pricePreviousSettlement);
    if (!month || settlement == null) continue;
    const settled = isoDate(item.datePreviousSettlement);
    if (settled && settled > settledOn) settledOn = settled;
    contracts.push({
      symbol,
      month,
      settlement,
      last: price(item.priceLastTrade),
      lastTradeOn: isoDate(item.dateLastTrade),
      bid: price(item.priceBid),
      ask: price(item.priceAsk),
      volume: typeof item.volume === "number" && Number.isFinite(item.volume) ? item.volume : 0,
    });
  }
  if (contracts.length === 0) throw new Error("ASX returned no cash rate futures");
  contracts.sort((a, b) => a.month.localeCompare(b.month));
  return { settledOn, contracts };
}

/** Month → the average cash rate it prices, in percent. */
export function monthAverages(contracts: ReadonlyArray<Pick<IbContract, "month" | "settlement">>): Map<string, number> {
  return new Map(contracts.map((entry) => [entry.month, 100 - entry.settlement]));
}

export interface PathMeeting {
  /** The decision day (announced 2:30 pm Sydney). */
  date: string;
  /** The day the new rate applies: the day after the decision. */
  effective: string;
  /** Rates in percent, on the cash rate (not target) basis the contracts settle on. */
  pre: number;
  post: number;
  /** Post less pre, in percentage points. */
  move: number;
  /** Post less today's rate. */
  cumulative: number;
  /** `month`: a whole month at the new rate; `weighted`: split from the month the meeting falls in. */
  method: "month" | "weighted";
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/**
 * The rate after each upcoming meeting, as far as the strip reaches. A meeting
 * whose new rate starts on the 1st, or that is followed by a month without a
 * meeting, reads straight off a whole month's average. Otherwise the month it
 * falls in is split by calendar days: `post = (avg × D − pre × d_pre) / d_post`.
 * The whole-month reading is preferred because the split magnifies the
 * contract's noise by D / d_post. `startRate` is today's cash rate.
 */
export function impliedPath(averages: ReadonlyMap<string, number>, meetings: readonly string[], startRate: number, today: string): PathMeeting[] {
  const upcoming = meetings.filter((date) => date >= today).toSorted();
  const effectiveMonths = new Set(upcoming.map((date) => addDays(date, 1).slice(0, 7)));
  const path: PathMeeting[] = [];
  let pre = startRate;
  for (const date of upcoming) {
    const effective = addDays(date, 1);
    const month = effective.slice(0, 7);
    const following = nextMonth(month);
    let post: number | undefined;
    let method: PathMeeting["method"] = "month";
    if (effective.endsWith("-01")) {
      post = averages.get(month);
    } else if (!effectiveMonths.has(following) && averages.has(following)) {
      post = averages.get(following);
    } else {
      const average = averages.get(month);
      if (average != null) {
        const days = daysInMonth(month);
        const before = Number(effective.slice(8, 10)) - 1;
        post = (average * days - pre * before) / (days - before);
        method = "weighted";
      }
    }
    if (post == null) break;
    path.push({ date, effective, pre, post, move: post - pre, cumulative: post - startRate, method });
    pre = post;
  }
  return path;
}

export interface ScheduledMeeting {
  date: string;
  /** Not yet published by the RBA: projected from the last published year. */
  estimated: boolean;
}

/**
 * The published decision dates, then estimates as far as `throughMonth` (the
 * strip's last contract). Each estimate is a meeting in the last published
 * year 364 days on, and so on year by year: the same weekday (the board
 * decides on Tuesdays) in about the same week. Estimates stop once the RBA's
 * schedule for that year is added to the published dates.
 */
export function meetingSchedule(confirmed: readonly string[], throughMonth: string): ScheduledMeeting[] {
  const published = confirmed.toSorted();
  const schedule: ScheduledMeeting[] = published.map((date) => ({ date, estimated: false }));
  const lastYear = published.at(-1)?.slice(0, 4);
  if (!lastYear) return schedule;
  const base = published.filter((date) => date.startsWith(lastYear));
  const estimates: string[] = [];
  // The strip runs about 18 months, so a few years is plenty; the bound keeps a bad month from looping.
  for (let years = 1; years <= 5; years += 1) {
    const next = base.map((date) => addDays(date, 364 * years)).filter((date) => date.slice(0, 4) > lastYear);
    const within = next.filter((date) => date.slice(0, 7) <= throughMonth);
    estimates.push(...within);
    if (within.length < next.length) break;
  }
  return [...schedule, ...estimates.toSorted().map((date) => ({ date, estimated: true }))];
}

/** A move as 25 bp steps: the two-outcome odds of a move at a meeting, -0.62 being 62% odds of a cut. */
export function moveSteps(move: number | null): number | null {
  return move == null || !Number.isFinite(move) ? null : move / 0.25;
}

/** `62% cut`; above 100% more than one move is priced at that meeting. */
export function moveOddsText(move: number | null): string {
  const steps = moveSteps(move);
  if (steps == null) return "—";
  const percent = Math.round(Math.abs(steps) * 100);
  return percent === 0 ? "0%" : `${percent}% ${steps > 0 ? "hike" : "cut"}`;
}

/** The held date nearest `target`, up to `toleranceDays` either side; the earlier one wins a tie. */
export function nearestDate(target: string, held: (date: string) => boolean, toleranceDays = 3): string | null {
  for (let offset = 0; offset <= toleranceDays; offset += 1) {
    for (const date of offset === 0 ? [target] : [addDays(target, -offset), addDays(target, offset)]) {
      if (held(date)) return date;
    }
  }
  return null;
}
