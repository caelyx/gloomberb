import type { TickerRecord } from "gloomberb/types/ticker";
import { canonicalExchange, normalizeSymbol, parsePublicTickerKey } from "gloomberb/utils";

/** All ASX wall-clock times (announcement stamps, sessions) are Sydney time. */
export const ASX_TIME_ZONE = "Australia/Sydney";

/**
 * Venues that trade ASX-listed securities. Cboe Australia (CXA, now TMX
 * Australia) trades the same ASX codes, so a CXA line is still an ASX issuer.
 */
const ASX_VENUES = new Set(["ASX", "XASX", "CXA", "CHIA", "CHI-X AUSTRALIA"]);

const ASX_CODE = /^[A-Z0-9]{3,6}$/;

export function isAsxVenue(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  const value = exchange.trim().toUpperCase();
  return ASX_VENUES.has(value) || ASX_VENUES.has(canonicalExchange(value));
}

/**
 * The ASX code a symbol names: `BHP.AX`, `BHP:ASX`, or a bare `BHP` when the
 * caller already knows the venue. Null when the symbol is not an ASX listing.
 */
export function asxCodeFromSymbol(symbol: string | null | undefined, exchange?: string | null): string | null {
  if (!symbol) return null;
  const normalized = normalizeSymbol(symbol);
  if (normalized.endsWith(".AX")) {
    const code = normalized.slice(0, -3);
    return ASX_CODE.test(code) ? code : null;
  }
  const parsed = parsePublicTickerKey(normalized);
  const venue = parsed.exchange ?? exchange ?? null;
  if (!isAsxVenue(venue)) return null;
  return ASX_CODE.test(parsed.symbol) ? parsed.symbol : null;
}

/** The ASX code of a saved ticker, from its symbol, venue, or primary broker contract. */
export function asxCodeForTicker(ticker: TickerRecord | null | undefined, symbol?: string | null): string | null {
  const metadata = ticker?.metadata;
  const contract = metadata?.broker_contracts?.[0];
  const venues = [metadata?.exchange, contract?.primaryExchange, contract?.exchange];
  const candidates = [symbol, metadata?.ticker, contract?.symbol];
  for (const candidate of candidates) {
    const direct = asxCodeFromSymbol(candidate);
    if (direct) return direct;
    for (const venue of venues) {
      const viaVenue = asxCodeFromSymbol(candidate, venue);
      if (viaVenue) return viaVenue;
    }
  }
  return null;
}
