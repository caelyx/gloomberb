import type { OptionContract, OptionsChain } from "gloomberb/types/financials";

/** ASX shows exchange-traded options 20 minutes delayed. */
export const ASX_OPTIONS_DELAY_MINUTES = 20;

interface RawContract {
  chainType?: unknown;
  dateExpiry?: unknown;
  openInterest?: unknown;
  priceAsk?: unknown;
  priceBid?: unknown;
  priceExercise?: unknown;
  priceLast?: unknown;
  style?: unknown;
  symbol?: unknown;
  volume?: unknown;
}

interface RawExerciseGroup {
  priceExercise?: unknown;
  call?: RawContract | null;
  put?: RawContract | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Feed prices carry float noise (18.865000000000002); ASX quotes to the tenth of a cent. */
function price(value: unknown): number | null {
  const parsed = num(value);
  return parsed == null ? null : Math.round(parsed * 10_000) / 10_000;
}

/** `YYYY-MM-DD` to Unix seconds at midnight UTC, the host's expiry convention. */
export function expirySeconds(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function toContract(raw: RawContract, expiration: number, underlying: number | null, side: "call" | "put"): OptionContract | null {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim() : "";
  const strike = num(raw.priceExercise);
  if (!symbol || strike == null) return null;
  const volume = num(raw.volume);
  const openInterest = num(raw.openInterest);
  return {
    contractSymbol: symbol,
    strike,
    currency: "AUD",
    // ASX reports 0 for a series that has not traded.
    lastPrice: price(raw.priceLast) ?? 0,
    change: 0,
    percentChange: 0,
    ...(volume != null ? { volume } : {}),
    ...(openInterest != null ? { openInterest } : {}),
    bid: price(raw.priceBid) ?? 0,
    ask: price(raw.priceAsk) ?? 0,
    impliedVolatility: 0,
    inTheMoney: underlying != null && (side === "call" ? underlying > strike : underlying < strike),
    expiration,
    lastTradeDate: 0,
  };
}

export interface ExpiryContracts {
  /** Unix seconds. */
  expiration: number;
  calls: OptionContract[];
  puts: OptionContract[];
}

/**
 * Expiry groups as both option endpoints return them. ASX lists a
 * European-style twin beside many American series, at the strike plus a cent;
 * the host's chain has no style field, so an expiry keeps its American series
 * and falls back to European ones only when it has no American series at all.
 */
export function parseExpiryGroups(items: unknown, underlying: number | null): ExpiryContracts[] {
  if (!Array.isArray(items)) throw new Error("ASX options format was not recognised");
  const result: ExpiryContracts[] = [];
  for (const item of items as Array<{ date?: unknown; exerciseGroups?: unknown }>) {
    const expiration = typeof item.date === "string" ? expirySeconds(item.date) : null;
    if (expiration == null || !Array.isArray(item.exerciseGroups)) continue;
    const groups = item.exerciseGroups as RawExerciseGroup[];
    const hasAmerican = groups.some((group) => group.call?.style === "American" || group.put?.style === "American");
    const keep = (raw: RawContract | null | undefined) => !!raw && (!hasAmerican || raw.style === "American");
    const calls: OptionContract[] = [];
    const puts: OptionContract[] = [];
    for (const group of groups) {
      if (keep(group.call)) { const contract = toContract(group.call!, expiration, underlying, "call"); if (contract) calls.push(contract); }
      if (keep(group.put)) { const contract = toContract(group.put!, expiration, underlying, "put"); if (contract) puts.push(contract); }
    }
    calls.sort((a, b) => a.strike - b.strike);
    puts.sort((a, b) => a.strike - b.strike);
    result.push({ expiration, calls, puts });
  }
  return result;
}

export interface AsxOptionsOverview {
  /** Every listed expiry, Unix seconds, ascending. */
  expirations: number[];
  /** The expiry the overview carries (the nearest monthly). */
  first: ExpiryContracts | null;
  underlying: number | null;
}

/** `derivatives/equity/{code}/options`: listed expiries, the nearest one's series, and the underlying price. */
export function parseOptionsOverview(payload: unknown): AsxOptionsOverview {
  const data = (payload as { data?: Record<string, any> } | null)?.data;
  if (!data || !data.expiryGroups) throw new Error("ASX options format was not recognised");
  const underlying = num(data.underlyingAsset?.priceLast);
  const groups = parseExpiryGroups(data.expiryGroups.items, underlying);
  const available = data.datesAvailable && typeof data.datesAvailable === "object"
    ? Object.values(data.datesAvailable as Record<string, unknown>).flatMap((dates) => (Array.isArray(dates) ? dates : []))
    : [];
  const listed = new Set(available.filter((date): date is string => typeof date === "string").map(expirySeconds).filter((value): value is number => value != null));
  for (const group of groups) listed.add(group.expiration);
  return { expirations: [...listed].sort((a, b) => a - b), first: groups[0] ?? null, underlying };
}

/** `…/options/expiry-groups?expiryDates[]=…`: the series for chosen expiries. */
export function parseExpiryGroupsResponse(payload: unknown, underlying: number | null): ExpiryContracts[] {
  return parseExpiryGroups((payload as { data?: { items?: unknown } } | null)?.data?.items, underlying);
}

/** Seconds to the `YYYY-MM-DD` the expiry-groups request takes. */
export function expiryDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function buildChain(underlyingSymbol: string, expirations: number[], contracts: ExpiryContracts, asOf = new Date()): OptionsChain {
  return {
    underlyingSymbol,
    expirationDates: expirations,
    calls: contracts.calls,
    puts: contracts.puts,
    dataSource: "delayed",
    delayMinutes: ASX_OPTIONS_DELAY_MINUTES,
    asOf: asOf.toISOString(),
  };
}
