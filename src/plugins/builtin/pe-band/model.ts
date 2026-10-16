import { fxLegForCurrency } from "../../../market-data/coordinator/fx-legs";
import { regularSessionValuationPrice } from "../../../market-data/quotes/regular-session-valuation";
import { fxCloseOnOrBefore, type FxCloses } from "../../../market-data/fx-closes";
import { extractFundamentalSeries } from "../../../time-series/fundamentals";
import type { SecuritySeriesSource, TimeSeriesPoint } from "../../../time-series/types";
import { createValuationCurrencyContext } from "../../../time-series/valuation-currency";
import type { FinancialStatement, PricePoint, TickerFinancials } from "../../../types/financials";
import { resolveCurrencyUnit, type CurrencyUnitInfo } from "../../../utils/currency-units";
import { areNearbyFinancialPeriodEnds } from "../../../utils/financial-statements";
import { datedByReport, type ReportDate } from "./report-dates";

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
/**
 * A figure stops pricing weeks this long after its period end. Sixteen months
 * covers a fiscal year plus its filing, so a year of unavailable quarterly
 * sums falls back on the last annual figure but never on one long overdue.
 */
const STALE_EPS_MS = 487 * DAY_MS;
/** Spacing between band multiples, finest first; the first that needs four lines or fewer wins. */
const MULTIPLE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const MAX_BANDS = 4, MIN_BANDS = 3;

/** One trailing-twelve-month EPS figure and when it became known. */
export interface EpsStep {
  /** ISO period end. */
  periodEnd: string;
  /** Four reported quarters summed, or a reported fiscal year. */
  basis: "ttm" | "annual";
  knownAt: Date;
  /** False when no publication date or report is on record and `knownAt` is the period end. */
  dated: boolean;
  /** Statement currency units; null when unavailable (a declared gap or an incomplete run of quarters). */
  eps: number | null;
  currency: string | null;
}

interface PeBandWeek {
  date: Date;
  close: number;
  /** Trailing EPS in force that week, in price units; null when none or not positive. */
  eps: number | null;
  pe: number | null;
}

export interface PeBandRow extends EpsStep {
  /** The close of the week the figure became known, in price units. */
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
  weeks: PeBandWeek[];
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
 * A split restates EPS onto the new share count, and SEC history dates the
 * restated figure by the filing that evidenced the split. The earnings were
 * known at the original filing; the price history is split-adjusted the same
 * way, so the restated figure steps when it was first filed.
 */
function knownWhenFiled(row: FinancialStatement): FinancialStatement {
  const filed = row.epsBasis?.status === "split-adjusted" ? row.epsBasis.originalFiled : undefined;
  if (!filed || !Number.isFinite(Date.parse(filed))) return row;
  const current = row.fieldAvailability !== undefined ? row.fieldAvailability.eps : row.availableAt;
  if (current && Date.parse(current) <= Date.parse(filed)) return row;
  return { ...row, fieldAvailability: { ...row.fieldAvailability, eps: filed } };
}

function epsSeries(financials: TickerFinancials, period: "ttm" | "annual"): TimeSeriesPoint[] {
  const source: SecuritySeriesSource = { kind: "security", instrument: { symbol: "" }, fieldId: "fundamental.eps", period, timestampMode: "available-at" };
  return extractFundamentalSeries(financials, source);
}

/**
 * Trailing EPS through time, oldest first. Four reported quarters are summed
 * by the shared statement series, which keeps declared gaps and broken runs
 * of quarters unavailable. A reported fiscal year is itself a trailing
 * twelve-month figure; at a fiscal year end it replaces the quarterly sum.
 * A figure is known no later than the company's report of that quarter, when
 * `reports` has it, including one with no publication date of its own.
 */
export function trailingEpsSteps(financials: TickerFinancials, reports: readonly ReportDate[] = []): EpsStep[] {
  const known = (row: FinancialStatement) => datedByReport(knownWhenFiled(row), reports);
  const adjusted = { ...financials, quarterlyStatements: financials.quarterlyStatements.map(known),
    annualStatements: financials.annualStatements.map(known) };
  const toStep = (basis: EpsStep["basis"]) => (point: TimeSeriesPoint): EpsStep => ({
    periodEnd: point.observedAt.toISOString().slice(0, 10), basis, knownAt: point.date, dated: point.availableAt !== undefined,
    eps: point.value != null && Number.isFinite(point.value) ? point.value : null, currency: point.provenance?.currency ?? null,
  });
  const steps = epsSeries(adjusted, "annual").map(toStep("annual"));
  for (const step of epsSeries(adjusted, "ttm").map(toStep("ttm"))) {
    const index = steps.findIndex((other) => areNearbyFinancialPeriodEnds(other.periodEnd, step.periodEnd));
    if (index < 0) steps.push(step);
    else if (steps[index]!.eps == null && step.eps != null) steps[index] = step;
  }
  return steps.sort((a, b) => a.knownAt.getTime() - b.knownAt.getTime() || a.periodEnd.localeCompare(b.periodEnd));
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
  return step && time - Date.parse(step.periodEnd) <= STALE_EPS_MS ? step : null;
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
  },
): PeBandModel {
  const currency = financials?.quote?.currency ?? null;
  const empty: PeBandModel = { symbol: options.symbol, currency, weeks: [], rows: [], multiples: [], current: null, range: null, sample: null, bandCeiling: null,
    undated: 0, unavailable: 0, conversion: null, error: null, notice: null };
  if (!financials) return { ...empty, error: "Fundamentals unavailable." };
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
  // Cached history can carry ISO strings for dates.
  const sorted = history.map((point) => ({ date: new Date(point.date), close: point.close }))
    .filter((point) => Number.isFinite(point.date.getTime()) && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const weeks = sorted.filter((point) => point.date.getTime() >= start).map((point): PeBandWeek => {
    // Converted at the FX close of the bar's date, the same date that picks the EPS in force, so each week's multiple
    // moves with the price and the currency together rather than with the rate of an old publication date.
    const eps = priced(stepAt(allSteps, point.date.getTime()), day(point.date))?.eps ?? null;
    const positive = eps != null && eps > 0 ? eps : null;
    return { date: point.date, close: point.close, eps: positive, pe: positive ? point.close / positive : null };
  });

  const steps = allSteps.filter((step) => step.knownAt.getTime() >= start);
  const rows = steps.filter((step) => step.eps != null).map((step): PeBandRow => {
    const time = step.knownAt.getTime();
    const price = sorted.findLast((point) => point.date.getTime() <= time)?.close ?? null;
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
  const currentStep = stepAt(allSteps, now);
  // Today's EPS at the latest completed FX close.
  const currentEps = priced(currentStep, day(now))?.eps ?? null;
  const latestFx = unitScale(latest) == null ? fxAt(latest, day(now)) : null;
  const currentPe = price != null && currentEps != null && currentEps > 0 ? price / currentEps : null;
  const multiples = chooseMultiples(pes, currentPe);
  const above = currentPe == null ? undefined : multiples.find((multiple) => multiple >= currentPe);
  const highestClose = weeks.reduce((max, week) => Math.max(max, week.close), 0);
  return {
    ...empty, weeks, rows, multiples,
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
