import { fxLegForCurrency } from "../../../market-data/coordinator/fx-legs";
import { regularSessionValuationPrice } from "../../../market-data/quotes/regular-session-valuation";
import { fxCloseOnOrBefore, type FxCloses } from "../../../market-data/fx-closes";
import { knownWhenFiled } from "../../../time-series/fundamentals";
import { STALE_TRAILING_EPS_MS, trailingEpsSteps as sharedTrailingEpsSteps, type EpsStep } from "../../../time-series/filed-trailing-eps";
import { createValuationCurrencyContext } from "../../../time-series/valuation-currency";
import type { FinancialStatement, PricePoint, TickerFinancials } from "../../../types/financials";
import { resolveCurrencyUnit, type CurrencyUnitInfo } from "../../../utils/currency-units";
import { notTheShare } from "../../../utils/share-multiples";
import { datedByReport, type ReportDate } from "./report-dates";

export type { EpsStep };

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
/** Spacing between band multiples, finest first; the first that needs four lines or fewer wins. */
const MULTIPLE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const MAX_BANDS = 4, MIN_BANDS = 3;

interface PeBandWeek {
  date: Date;
  close: number;
  /** Trailing EPS in force that week, in price units; null when none or not positive. */
  eps: number | null;
  pe: number | null;
}

export interface PeBandRow extends EpsStep {
  /**
   * The close of the day the figure became known (the last session on or
   * before it), in price units; before the daily closes on record, the close
   * of the weekly bar dated on or before it.
   */
  price: number | null;
  pe: number | null;
  /** Change from the figure a year earlier in the same currency, when both are positive. */
  yoy: number | null;
  /** The daily FX close the figure was converted at, when it is in another currency than the price. */
  fx: FxClose | null;
}

/** Units of the price's whole currency per unit of the statement currency, crossed through the dollar at daily FX closes. */
interface FxClose {
  /** The older of the two closes when neither currency is the dollar. */
  date: string;
  rate: number;
  from: string;
  to: string;
}

/** EPS reported in another currency than the price, converted at daily FX closes. */
interface EpsConversion {
  /** The statement currency of today's EPS. */
  currency: string;
  /** The latest completed close, which converts today's EPS. */
  latest: FxClose;
}

export interface PeBandModel {
  symbol: string;
  /** Price currency. */
  currency: string | null;
  /**
   * The weekly closes the percentile and range rank over, each dated by the
   * session it closed on where the daily closes cover its week (a bar is
   * dated by its first day, its close by its last).
   */
  weeks: PeBandWeek[];
  /**
   * What the chart draws: the weeks, and the close of each day a figure in
   * the table became known, so selecting its row puts the chart's cursor on
   * that day and the price the row reads.
   */
  points: PeBandWeek[];
  /** Newest first. */
  rows: PeBandRow[];
  multiples: number[];
  current: { price: number; eps: number | null; pe: number | null; percentile: number | null; step: EpsStep | null } | null;
  range: { min: number; median: number; max: number } | null;
  /** The weekly P/E readings the percentile and range rank over: the first one's date and how many. */
  sample: { start: Date; weeks: number } | null;
  /**
   * Band values above this are left off the chart, so the value axis fits the
   * price and the lines near it: one and a half times the highest close, or
   * the line just above today's P/E when that is higher.
   */
  bandCeiling: number | null;
  /** Figures in the window dated by period end because neither a publication date nor a report is on record. */
  undated: number;
  /** Trailing sums in the window that are unavailable (a quarter's EPS is withheld or not reported). */
  unavailable: number;
  /** Set when today's EPS is in another currency than the price. */
  conversion: EpsConversion | null;
  /** Blocks the pane: nothing can be priced. */
  error: string | null;
  /** The pane still draws, but without bands. */
  notice: string | null;
}

/**
 * Trailing EPS through time, oldest first, as the headline EPS (TTM) reads it
 * (time-series/filed-trailing-eps). A figure is known no later than the
 * company's report of that quarter, when `reports` has it, including one with
 * no publication date of its own.
 */
export function trailingEpsSteps(financials: TickerFinancials, reports: readonly ReportDate[] = []): EpsStep[] {
  return sharedTrailingEpsSteps(financials, (row: FinancialStatement) => datedByReport(knownWhenFiled(row), reports));
}

/**
 * Decimals that keep three significant digits of a per-share amount: two from
 * 1 up, more below it, so 0.0712 does not print as 0.07 and a YoY can be
 * recomputed from the figures shown.
 */
export function perShareDigits(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude >= 1 || magnitude === 0 || !Number.isFinite(magnitude) ? 2 : Math.min(6, Math.ceil(-Math.log10(magnitude)) + 2);
}

export const formatPerShare = (value: number) => value.toFixed(perShareDigits(value));

/**
 * A rate in the pair's market convention, from units of `to` per unit of
 * `from`: "USD/TWD 31.99" (Taiwan dollars per dollar), "AUD/USD 0.66"
 * (dollars per Australian dollar). A pair without the dollar reads from
 * `from`: "EUR/GBP 0.87".
 */
export function fxPairQuote(from: string, to: string, rate: number): { pair: string; value: number } {
  if (from !== "USD" && to !== "USD") return { pair: `${from}/${to}`, value: rate };
  const currency = to === "USD" ? from : to;
  const usdPerUnit = to === "USD" ? rate : 1 / rate;
  const perDollar = fxLegForCurrency(currency)?.invert ?? true;
  return perDollar ? { pair: `USD/${currency}`, value: 1 / usdPerUnit } : { pair: `${currency}/USD`, value: usdPerUnit };
}

/** A whole currency that converts through the dollar: USD itself or one with a daily dollar pair. */
function fxCurrency(code: string | null | undefined): string | null {
  const unit = resolveCurrencyUnit(code);
  return unit.divisor === 1 && (unit.currency === "USD" || fxLegForCurrency(unit.currency)) ? unit.currency : null;
}

/** The price's currency unit (GBP with divisor 100 for pence) when its whole currency converts through the dollar. */
function priceFxUnit(code: string | null | undefined): CurrencyUnitInfo | null {
  const unit = resolveCurrencyUnit(code);
  return unit.currency === "USD" || fxLegForCurrency(unit.currency) ? unit : null;
}

/**
 * The currencies whose daily dollar closes convert EPS reported in another
 * currency than the price (the price's own among them unless it is USD), and
 * the oldest statement they convert. Rows without a declared currency are
 * never converted.
 */
export function epsFxNeeds(financials: TickerFinancials): { currencies: string[]; oldest: string } | null {
  const price = priceFxUnit(financials.quote?.currency);
  if (!price) return null;
  const rows = [...financials.annualStatements, ...financials.quarterlyStatements].filter((row) => {
    const currency = typeof row.eps === "number" ? fxCurrency(row.currency?.trim()) : null;
    return currency != null && currency !== price.currency && Number.isFinite(Date.parse(row.date));
  });
  if (!rows.length) return null;
  const currencies = [...new Set([...rows.map((row) => fxCurrency(row.currency?.trim())!), price.currency])].filter((code) => code !== "USD");
  return { currencies, oldest: rows.map((row) => row.date).sort()[0]! };
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

/**
 * Round multiples around today's P/E and across the stock's own history. The
 * span runs from the 5th to the 95th percentile of the weekly P/E, stretched
 * to take in today's P/E and cut to between half and twice it, so a history
 * far from today (AMZN at 600x a decade ago, 20x now) cannot push every line
 * away from the price. The finest spacing (1x, 2x, 5x, 10x...) that needs
 * four lines or fewer wins, and the lines always include the round multiples
 * on either side of today's P/E. Without a current P/E the span is the
 * history's alone. Three lines at least, widened toward the side the lines
 * leave more of the span uncovered.
 */
export function chooseMultiples(pes: readonly number[], current?: number | null): number[] {
  const sorted = pes.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const today = current != null && Number.isFinite(current) && current > 0 ? current : null;
  let low = quantile(sorted, 0.05), high = quantile(sorted, 0.95);
  if (today) {
    low = Math.max(Math.min(low, today), today / 2);
    high = Math.min(Math.max(high, today), today * 2);
  }
  for (const step of MULTIPLE_STEPS) {
    let first = Math.max(1, Math.ceil(low / step)), last = Math.floor(high / step);
    if (today) {
      first = Math.max(1, Math.min(first, Math.floor(today / step)));
      last = Math.max(last, Math.ceil(today / step));
    }
    if (last - first + 1 > MAX_BANDS) continue;
    while (last - first + 1 < MIN_BANDS) {
      // An empty span (both bounds between two lines) takes the nearest line on each side.
      if (last < first) [first, last] = [last, first];
      if (first > 1 && first * step - low >= high - last * step) first -= 1;
      else last += 1;
    }
    return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
  }
  return [];
}

/** Positive closes in time order; cached history can carry ISO strings for dates. */
function closesOf(history: readonly PricePoint[]): Array<{ date: Date; close: number }> {
  return history.map((point) => ({ date: new Date(point.date), close: point.close }))
    .filter((point) => Number.isFinite(point.date.getTime()) && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Weekly bars dated by the session their close is from. A bar is dated by
 * its week's first day, so DWSN's week of 9 Nov 2026 read 9 Nov with the
 * close of Friday the 13th. Where the daily closes cover a week, the bar
 * takes the date of the last daily close before the next bar; elsewhere it
 * keeps its own.
 */
function closingSessions<T extends { date: Date }>(weekly: readonly T[], daily: readonly { date: Date }[]): T[] {
  let at = 0;
  return weekly.map((bar, index) => {
    const from = bar.date.getTime();
    const until = weekly[index + 1]?.date.getTime() ?? Number.POSITIVE_INFINITY;
    while (at < daily.length && daily[at]!.date.getTime() < from) at += 1;
    let last: { date: Date } | null = null;
    while (at < daily.length && daily[at]!.date.getTime() < until) last = daily[at++]!;
    return last ? { ...bar, date: last.date } : bar;
  });
}

/** Percent of `values` at or below `value`. */
function percentileRank(values: readonly number[], value: number): number | null {
  return values.length ? 100 * values.filter((other) => other <= value).length / values.length : null;
}

/**
 * The figure in force at `time`: of those known by then, the one for the
 * latest period, unless it is overdue. An unavailable sum does not erase the
 * figure before it; that figure stays in force until it goes stale.
 */
export function stepAt(steps: readonly EpsStep[], time: number): EpsStep | null {
  let step: EpsStep | null = null;
  for (const candidate of steps) {
    if (candidate.eps == null || candidate.knownAt.getTime() > time) continue;
    if (!step || candidate.periodEnd > step.periodEnd) step = candidate;
  }
  return step && time - Date.parse(step.periodEnd) <= STALE_TRAILING_EPS_MS ? step : null;
}

export function projectPeBand(
  financials: TickerFinancials | null,
  history: readonly PricePoint[],
  options: {
    symbol: string; lookbackYears: number; now?: number; reports?: readonly ReportDate[];
    /** Daily dollar closes by currency, for EPS in another currency than the price. */
    fx?: ReadonlyMap<string, FxCloses>;
    /** Why a needed FX history is missing, said when it leaves today's EPS unconverted. */
    fxError?: string | null;
    /** Daily closes for the recent years they are served for (see `weeks` and `PeBandRow.price`). */
    daily?: readonly PricePoint[];
  },
): PeBandModel {
  const currency = financials?.quote?.currency ?? null;
  const empty: PeBandModel = { symbol: options.symbol, currency, weeks: [], points: [], rows: [], multiples: [], current: null, range: null, sample: null, bandCeiling: null,
    undated: 0, unavailable: 0, conversion: null, error: null, notice: null };
  if (!financials) return { ...empty, error: "Fundamentals unavailable." };
  // A warrant's, a right's, a unit's or an unratioed receipt's price over its company's EPS is no P/E at any date.
  const share = notTheShare(financials);
  if (share) return { ...empty, error: `No P/E: ${share}.` };
  const allSteps = trailingEpsSteps(financials, options.reports);
  const latest = allSteps.findLast((step) => step.eps != null);
  if (!latest) return { ...empty, error: "No trailing EPS on record." };
  const units = createValuationCurrencyContext(financials);
  // Price units per statement unit: 1 for the same currency, 100 for a pence price against pound statements.
  const unitScale = (step: EpsStep) => {
    const factor = units.priceInStatementUnits({ date: step.periodEnd, currency: step.currency ?? undefined }, 1);
    return factor ? 1 / factor : null;
  };
  // ADRs and cross-listings report in one currency and trade in another (TSM: TWD against USD; BHP.AX: USD against AUD).
  const priceUnit = priceFxUnit(currency);
  const foreign = (step: EpsStep) => {
    const code = priceUnit ? fxCurrency(step.currency) : null;
    return code !== priceUnit?.currency ? code : null;
  };
  const usdPerUnit = (code: string, date: string): { date: string | null; rate: number } | null => {
    if (code === "USD") return { date: null, rate: 1 };
    const history = options.fx?.get(code);
    return history ? fxCloseOnOrBefore(history, date) : null;
  };
  /** The statement currency's rate in the price's whole currency at the daily closes on or before `date` (YYYY-MM-DD). */
  const fxAt = (step: EpsStep, date: string): FxClose | null => {
    const from = foreign(step);
    if (!from) return null;
    const eps = usdPerUnit(from, date), price = usdPerUnit(priceUnit!.currency, date);
    if (!eps || !price) return null;
    const dates = [eps.date, price.date].filter((value): value is string => value != null).sort();
    return { date: dates[0]!, rate: eps.rate / price.rate, from, to: priceUnit!.currency };
  };
  const day = (time: Date | number) => new Date(time).toISOString().slice(0, 10);
  const now = options.now ?? Date.now();
  if (unitScale(latest) == null && !fxAt(latest, day(now))) {
    return { ...empty, error: !currency || !latest.currency ? "The price or EPS currency is unknown."
      : `EPS is reported in ${latest.currency} and the price is in ${currency}${foreign(latest) && options.fxError ? `; ${options.fxError}` : ""}.` };
  }
  /** The EPS in price units on `date` (YYYY-MM-DD), with the FX close used when it was converted. */
  const priced = (step: EpsStep | null, date: string): { eps: number; fx: FxClose | null } | null => {
    if (step?.eps == null) return null;
    const factor = unitScale(step);
    if (factor != null) return { eps: step.eps * factor, fx: null };
    const close = fxAt(step, date);
    return close ? { eps: step.eps * close.rate * priceUnit!.divisor, fx: close } : null;
  };

  const firstKnown = allSteps.find((step) => step.eps != null)!.knownAt.getTime();
  const start = Math.max(firstKnown, options.lookbackYears > 0 ? now - options.lookbackYears * YEAR_MS : firstKnown);
  const sorted = closesOf(history);
  const daily = closesOf(options.daily ?? []);
  const dailyStart = daily[0]?.date.getTime() ?? Number.POSITIVE_INFINITY;
  /** A close as the chart reads it: with the EPS in force on its day, and the P/E they make. */
  const reading = (point: { date: Date; close: number }): PeBandWeek => {
    // Converted at the FX close of the bar's date, the same date that picks the EPS in force, so each week's multiple
    // moves with the price and the currency together rather than with the rate of an old publication date.
    const eps = priced(stepAt(allSteps, point.date.getTime()), day(point.date))?.eps ?? null;
    const positive = eps != null && eps > 0 ? eps : null;
    return { date: point.date, close: point.close, eps: positive, pe: positive ? point.close / positive : null };
  };
  const weeks = closingSessions(sorted, daily).filter((point) => point.date.getTime() >= start).map(reading);

  /** The close of the day `time` falls on, or the last session before it, where the daily closes reach. */
  const dayClose = (time: number) => time >= dailyStart ? daily.findLast((point) => point.date.getTime() <= time) ?? null : null;
  const steps = allSteps.filter((step) => step.knownAt.getTime() >= start);
  const rows = steps.filter((step) => step.eps != null).map((step): PeBandRow => {
    const time = step.knownAt.getTime();
    const price = (dayClose(time) ?? sorted.findLast((point) => point.date.getTime() <= time))?.close ?? null;
    // Converted at the FX close of the day it became known.
    const converted = priced(step, day(step.knownAt));
    const eps = converted?.eps ?? null;
    const prior = allSteps.find((other) => other.eps != null && other.currency === step.currency
      && Math.abs(Date.parse(step.periodEnd) - Date.parse(other.periodEnd) - 365 * DAY_MS) <= 20 * DAY_MS);
    return { ...step, price, pe: price != null && eps != null && eps > 0 ? price / eps : null, fx: converted?.fx ?? null,
      yoy: step.eps != null && prior?.eps != null && step.eps > 0 && prior.eps > 0 ? step.eps / prior.eps - 1 : null };
  }).reverse();

  const ranked = weeks.filter((week) => week.pe != null);
  const pes = ranked.map((week) => week.pe!);
  const ordered = [...pes].sort((a, b) => a - b);
  // The regular session's price, as the quote headlines it: after the close, the close rather than an after-hours print.
  const price = regularSessionValuationPrice(financials.quote) ?? sorted.at(-1)?.close ?? null;
  // Today's figure reads like every week's: one whose newest quarter has no EPS keeps the last figure, dated in the
  // table, where the headline EPS (TTM) needs that quarter's own (filed-trailing-eps) and shows Gloom Cloud's, labelled.
  const currentStep = stepAt(allSteps, now);
  // Today's EPS at the latest completed FX close.
  const currentEps = priced(currentStep, day(now))?.eps ?? null;
  const latestFx = unitScale(latest) == null ? fxAt(latest, day(now)) : null;
  const currentPe = price != null && currentEps != null && currentEps > 0 ? price / currentEps : null;
  const multiples = chooseMultiples(pes, currentPe);
  const above = currentPe == null ? undefined : multiples.find((multiple) => multiple >= currentPe);
  const highestClose = weeks.reduce((max, week) => Math.max(max, week.close), 0);
  // Each dated row's day on the chart, the close it reads: its cursor lands there, not on the week around it.
  const rowDays = rows.flatMap((row) => {
    const close = row.dated ? dayClose(row.knownAt.getTime()) : null;
    return close && close.date.getTime() >= start ? [reading(close)] : [];
  });
  const byTime = new Map([...weeks, ...rowDays].map((point) => [point.date.getTime(), point]));
  const points = [...byTime.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    ...empty, weeks, points, rows, multiples,
    conversion: latestFx ? { currency: latestFx.from, latest: latestFx } : null,
    sample: ranked.length ? { start: ranked[0]!.date, weeks: ranked.length } : null,
    bandCeiling: highestClose > 0 ? Math.max(highestClose * 1.5, above != null && currentEps != null ? above * currentEps : 0) : null,
    current: price == null ? null : { price, eps: currentEps, pe: currentPe, step: currentStep,
      percentile: currentPe == null ? null : percentileRank(pes, currentPe) },
    range: ordered.length ? { min: ordered[0]!, median: quantile(ordered, 0.5), max: ordered.at(-1)! } : null,
    undated: steps.filter((step) => !step.dated && step.eps != null).length,
    unavailable: steps.filter((step) => step.eps == null).length,
    notice: pes.length ? null : "Trailing EPS was not positive in this window, so there is no P/E band.",
  };
}
