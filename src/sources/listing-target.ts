import { canonicalExchange, parsePublicTickerKey } from "../utils/exchanges";
import { createProviderMiss } from "./provider-errors";
import { hongKongListingCode, listingSuffixConflictsWithExchange, listingSuffixExchange } from "./listing-symbols";

/** Explicit public qualifications must agree; bare suffixes outrank remembered metadata. */
export function publicListingTarget(symbol: string, exchange?: string) {
  const parsed = parsePublicTickerKey(symbol);
  if (parsed.exchange && listingSuffixConflictsWithExchange(parsed.symbol, parsed.exchange)) {
    throw createProviderMiss(`Listing suffix conflicts with exchange ${parsed.exchange}: ${symbol}`);
  }
  return {
    symbol: parsed.symbol,
    exchange: parsed.exchange ?? listingSuffixExchange(parsed.symbol) ?? (exchange ? canonicalExchange(exchange) : exchange),
  };
}

/**
 * The symbol and venue a public key names on its home market. A recognised
 * listing suffix names the venue and outranks the saved one (`BHP.AX` is BHP
 * on ASX), and a Hong Kong code goes out with four digits (`700.HK` is 0700
 * on HKEX). Null when the key names an exchange its suffix rules out
 * (`BHP.AX:NYSE`).
 */
export function publicListingVenue(ticker: string, savedExchange = ""): { symbol: string; exchange: string } | null {
  const qualified = parsePublicTickerKey(ticker);
  if (qualified.exchange && listingSuffixConflictsWithExchange(qualified.symbol, qualified.exchange)) return null;
  const target = publicListingTarget(ticker, savedExchange);
  const exchange = canonicalExchange(target.exchange ?? "");
  const symbol = exchange && listingSuffixExchange(target.symbol) === exchange
    ? target.symbol.slice(0, target.symbol.indexOf("."))
    : target.symbol;
  return { symbol: exchange ? hongKongListingCode(symbol, exchange) : symbol, exchange };
}

/**
 * Home venues of caret-quoted indices whose venue publishes a session
 * calendar, so a bare `^AXJO` follows ASX sessions. Gloom Cloud is known to
 * serve `^AXJO` under ASX; the others assume the same convention.
 */
const INDEX_HOME_EXCHANGES: Readonly<Record<string, string>> = {
  "^AXJO": "ASX",
  "^AORD": "ASX",
  "^N225": "JPX",
  "^HSI": "HKEX",
  "^KS11": "KRX",
  "^NSEI": "NSE",
  "^BSESN": "BSE",
};

/** The home venue of a known index symbol, or undefined. */
export function indexHomeExchange(symbol: string): string | undefined {
  return Object.hasOwn(INDEX_HOME_EXCHANGES, symbol) ? INDEX_HOME_EXCHANGES[symbol] : undefined;
}

/** Preserve a provider's venue spelling when the symbol itself has no listing hint. */
export function publicListingExchange(symbol: string, exchange?: string): string | undefined {
  const parsed = parsePublicTickerKey(symbol);
  return parsed.exchange || listingSuffixExchange(parsed.symbol)
    ? publicListingTarget(symbol, exchange).exchange : exchange;
}

/** Keep each caller's target object when normalized requests are returned out of order. */
export function mapListingTargets<T extends { symbol: string; exchange?: string }>(
  targets: T[],
  resolveExchange: (target: T) => string | undefined = (target) => publicListingTarget(target.symbol, target.exchange).exchange,
) {
  const originals = new Map<T, T>();
  const valid: T[] = [];
  const invalid: Array<{ target: T; error: unknown }> = [];
  for (const target of targets) {
    try {
      const exchange = resolveExchange(target);
      const resolved = exchange === target.exchange ? target : { ...target, exchange };
      originals.set(resolved, target);
      valid.push(resolved);
    } catch (error) { invalid.push({ target, error }); }
  }
  return { valid, invalid, original: (target: T) => originals.get(target) ?? target };
}
