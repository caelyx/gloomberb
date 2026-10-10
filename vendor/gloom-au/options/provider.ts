import type { AssetDataProvider } from "gloomberb/types/data-provider";
import type { OptionsChain, TickerFinancials } from "gloomberb/types/financials";
import { asxCodeFromSymbol } from "../shared/asx";
import { createMemoryCache, fetchJson } from "../shared/http";
import { buildChain, expiryDate, parseExpiryGroupsResponse, parseOptionsOverview, type AsxOptionsOverview, type ExpiryContracts } from "./model";

const OPTIONS_URL = "https://asx.api.markitdigital.com/asx-research/1.0/derivatives/equity";
const overviewCache = createMemoryCache<AsxOptionsOverview>(2 * 60_000, 50);
const expiryCache = createMemoryCache<ExpiryContracts | null>(2 * 60_000, 200);

/**
 * The router asks every source for financials. A null would crash its
 * normalisation (logged, and this source marked as failing); a throw marks it
 * failing too. Financials whose listing identity is deliberately blank fail
 * the router's identity check, so it moves on silently.
 */
const NOT_THIS_SOURCE = Object.freeze({
  annualStatements: [],
  quarterlyStatements: [],
  priceHistory: [],
  quoteMetadata: { symbol: "" },
}) as unknown as TickerFinancials;

/** The router does not log a miss whose message says so; a miss is not a failure of this source. */
function miss(detail: string): Error {
  return new Error(`No data found: ${detail}`);
}

function loadOverview(code: string): Promise<AsxOptionsOverview> {
  return overviewCache.load(code, async () => parseOptionsOverview(await fetchJson<unknown>(`${OPTIONS_URL}/${encodeURIComponent(code)}/options`)));
}

function loadExpiry(code: string, expiration: number, underlying: number | null): Promise<ExpiryContracts | null> {
  return expiryCache.load(`${code}:${expiration}`, async () => {
    const search = new URLSearchParams();
    search.append("expiryDates[]", expiryDate(expiration));
    const groups = parseExpiryGroupsResponse(await fetchJson<unknown>(`${OPTIONS_URL}/${encodeURIComponent(code)}/options/expiry-groups?${search}`), underlying);
    return groups.find((group) => group.expiration === expiration) ?? null;
  });
}

/** A chain for one expiry: the nearest by default, any listed one on request. */
export async function loadAsxOptions(code: string, underlyingSymbol: string, expiration?: number): Promise<OptionsChain> {
  const overview = await loadOverview(code);
  if (!overview.first || overview.expirations.length === 0) throw miss(`no listed options for ${code}`);
  if (expiration == null || expiration === overview.first.expiration) {
    return buildChain(underlyingSymbol, overview.expirations, overview.first);
  }
  if (!overview.expirations.includes(expiration)) throw miss(`no ${code} options expire on ${expiryDate(expiration)}`);
  const contracts = await loadExpiry(code, expiration, overview.underlying);
  if (!contracts || (contracts.calls.length === 0 && contracts.puts.length === 0)) throw miss(`no ${code} series for ${expiryDate(expiration)}`);
  return buildChain(underlyingSymbol, overview.expirations, contracts);
}

/**
 * ASX exchange-traded options for Gloomberb's own Options views. Ranked after
 * Gloom Cloud, so it is only asked when the cloud has no chain (every ASX
 * listing today). Everything else it answers with "nothing" rather than an
 * error, so the router moves on and this source never looks unhealthy.
 */
export const asxOptionsProvider: AssetDataProvider = {
  id: "au-markets-asx-options",
  name: "ASX Options",
  priority: 150,
  // Only history and chart routing consult this; ASX options bring no history.
  canProvide: () => false,
  async getTickerFinancials() { return NOT_THIS_SOURCE; },
  // A null quote fails the router's identity check without being dereferenced.
  async getQuote() { return null as never; },
  async getQuoteMetadata() { return null; },
  // Ranked after the cloud, which always answers exchange rates; a null ranks as unusable if it ever gets here.
  async getExchangeRate() { return null as never; },
  async search() { return []; },
  async getArticleSummary() { return null; },
  async getPriceHistory() { return []; },
  async getOptionsChain(ticker, exchange, expirationDate) {
    const code = asxCodeFromSymbol(ticker, exchange);
    if (!code) throw miss(`no ASX options for ${ticker}`);
    return loadAsxOptions(code, ticker, expirationDate);
  },
};
