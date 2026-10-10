import type { DataProvider } from "gloomberb/types/data-provider";
import type { Quote } from "gloomberb/types/financials";
import { loadAsxDirectory } from "../directory/client";
import { createMemoryCache } from "../shared/http";
import { ASX_INDICES, ASX_SECTORS, BENCHMARK, returns, rotation, type Close, type Mover, type Returns, type Rotation } from "./model";

export interface BoardRow {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
  returns: Returns;
  rotation: Rotation | null;
  /** A year of daily closes, oldest first, for the board's chart. */
  history: Close[];
}

export interface Board {
  indices: BoardRow[];
  sectors: BoardRow[];
  asOf: number | null;
  errors: string[];
}

const historyCache = createMemoryCache<Close[]>(30 * 60_000, 40);

async function closes(provider: DataProvider, symbol: string, force?: boolean): Promise<Close[]> {
  return historyCache.load(symbol, async () => {
    const points = await provider.getPriceHistory(symbol, "", "1Y");
    return points
      .map((point) => ({ date: new Date(point.date).toISOString().slice(0, 10), close: point.close }))
      .filter((point) => Number.isFinite(point.close) && point.close > 0);
  }, force);
}

async function quotes(provider: DataProvider, targets: Array<{ symbol: string; exchange: string }>, force?: boolean): Promise<Map<string, Quote>> {
  const result = new Map<string, Quote>();
  if (provider.getQuotesBatch) {
    const batch = await provider.getQuotesBatch(targets.map((target) => ({ ...target, surface: "monitor" as const })), { forceRefresh: force });
    for (const entry of batch) if (entry.quote) result.set(entry.target.symbol, entry.quote);
    return result;
  }
  await Promise.all(targets.map(async (target) => {
    try { result.set(target.symbol, await provider.getQuote(target.symbol, target.exchange)); } catch { /* left out */ }
  }));
  return result;
}

/** Indices and sectors with returns, and each sector's rotation against the ASX 200. */
export async function loadBoard(provider: DataProvider, options: { force?: boolean } = {}): Promise<Board> {
  const all: Array<{ symbol: string; label: string }> = [...ASX_INDICES, ...ASX_SECTORS];
  const errors: string[] = [];
  const [quoteMap, histories] = await Promise.all([
    quotes(provider, all.map((entry) => ({ symbol: entry.symbol, exchange: "" })), options.force).catch((error) => {
      errors.push(`Quotes unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return new Map<string, Quote>();
    }),
    Promise.all(all.map((entry) => closes(provider, entry.symbol, options.force).catch(() => [] as Close[]))),
  ]);
  const historyBySymbol = new Map(all.map((entry, index) => [entry.symbol, histories[index]!]));
  const benchmark = historyBySymbol.get(BENCHMARK) ?? [];
  const missingHistory = all.filter((entry) => (historyBySymbol.get(entry.symbol)?.length ?? 0) === 0).map((entry) => entry.label);
  if (missingHistory.length) errors.push(`No history for ${missingHistory.join(", ")}`);
  const row = (entry: { symbol: string; label: string }, withRotation: boolean): BoardRow => {
    const quote = quoteMap.get(entry.symbol);
    const history = historyBySymbol.get(entry.symbol) ?? [];
    return {
      symbol: entry.symbol,
      label: entry.label,
      price: quote?.price ?? history.at(-1)?.close ?? null,
      changePercent: quote?.changePercent ?? null,
      returns: returns(history),
      rotation: withRotation ? rotation(history, benchmark) : null,
      history,
    };
  };
  const times = [...quoteMap.values()].map((quote) => quote.lastUpdated).filter((value): value is number => typeof value === "number");
  return {
    indices: ASX_INDICES.map((entry) => row(entry, false)),
    sectors: ASX_SECTORS.map((entry) => row(entry, true)),
    asOf: times.length ? Math.max(...times) : null,
    errors,
  };
}

/** The largest ASX companies by market cap, with today's move. */
export async function loadMovers(provider: DataProvider, options: { force?: boolean; universe?: number } = {}): Promise<Mover[]> {
  const directory = await loadAsxDirectory();
  const universe = [...directory]
    .filter((company) => company.marketCap != null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, options.universe ?? 100);
  const quoteMap = await quotes(provider, universe.map((company) => ({ symbol: company.code, exchange: "ASX" })), options.force);
  return universe.flatMap((company) => {
    const quote = quoteMap.get(company.code);
    return quote && Number.isFinite(quote.changePercent)
      ? [{ code: company.code, name: company.name, price: quote.price, changePercent: quote.changePercent, marketCap: company.marketCap }]
      : [];
  });
}
