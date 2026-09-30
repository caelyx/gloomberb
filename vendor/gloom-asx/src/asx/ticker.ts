import type { TickerRecord } from "gloomberb/types/ticker";
import { canonicalExchange, parsePublicTickerKey } from "gloomberb/utils";
import { normaliseAsxCode } from "./urls";

const YAHOO_SUFFIX = ".AX";

/**
 * The ASX code for a ticker, or null when the ticker is not an ASX listing.
 * Accepts the host's exchange metadata (`ASX`, `XASX`), an exchange-qualified
 * key (`CBA:ASX`) and Yahoo's `.AX` suffix.
 */
export function asxCodeForTicker(ticker: TickerRecord | null | undefined): string | null {
  const symbol = ticker?.metadata.ticker?.trim();
  if (!symbol) return null;
  const parsed = parsePublicTickerKey(symbol);
  const upper = parsed.symbol.toUpperCase();
  if (upper.endsWith(YAHOO_SUFFIX) && upper.length > YAHOO_SUFFIX.length) {
    return normaliseAsxCode(upper.slice(0, -YAHOO_SUFFIX.length));
  }
  const exchange = parsed.exchange ?? canonicalExchange(ticker?.metadata.exchange);
  return exchange === "ASX" ? normaliseAsxCode(upper) : null;
}

export function isAsxTicker(ticker: TickerRecord | null | undefined): boolean {
  return asxCodeForTicker(ticker) !== null;
}
