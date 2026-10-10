import type { CommandBarSearchProvider, GloomPluginContext } from "gloomberb/types/plugin";
import type { InstrumentSearchResult } from "gloomberb/types/instrument";
import { asxCodeFromSymbol } from "../shared/asx";
import { cachedAsxDirectory, loadAsxDirectory, searchAsx, searchAsxDirectory, type AsxCompany } from "./client";
import { loadAsxFunds } from "./funds";

function formatCap(value: number | null): string | undefined {
  if (value == null) return undefined;
  if (value >= 1e9) return `A$${(value / 1e9).toFixed(value >= 1e10 ? 0 : 1)}B`;
  if (value >= 1e6) return `A$${(value / 1e6).toFixed(0)}M`;
  return `A$${Math.round(value / 1e3)}K`;
}

/** The symbol form the host resolves to the ASX listing. */
export function asxSymbol(code: string): string {
  return `${code}.AX`;
}

/** Where the "ASX Listings" rows come from; injected so tests run on fixtures. */
export interface AsxListingSources {
  /** ASX's predictive search. It returns at most five rows, in name order, not by size. */
  live(query: string, signal: AbortSignal): Promise<AsxCompany[]>;
  /** The host's instrument search: it ranks by popularity, so it finds VAS for "vanguard australian". */
  host(query: string): Promise<readonly InstrumentSearchResult[]>;
  /** One code's ASX row (name, type, market cap), for listings only the host found. */
  lookup(code: string): Promise<AsxCompany | null>;
  /** The company directory and fund list, when neither search answers. */
  lists(): Promise<AsxCompany[]>;
}

/** Host listings looked up per code at most this many per query. */
const MAX_LOOKUPS = 4;

/** Exact code first, then the largest listings, then the order the sources gave. */
export function rankAsxListings(query: string, listings: readonly AsxCompany[]): AsxCompany[] {
  const needle = query.trim().toUpperCase().replace(/\.AX$/, "");
  return listings
    .map((company, index) => ({ company, index }))
    .sort((a, b) => Number(b.company.code === needle) - Number(a.company.code === needle)
      || (b.company.marketCap ?? -1) - (a.company.marketCap ?? -1)
      || a.index - b.index)
    .map((entry) => entry.company);
}

/**
 * ASX's search and the host's merged by code and ranked by size. ASX's search
 * alone stops at five names in alphabetical order, so "vanguard australian"
 * never reached VAS (A$26B) or VHY; the host finds them and ASX's code lookup
 * supplies their market cap.
 */
export async function findAsxListings(query: string, sources: AsxListingSources, signal: AbortSignal, limit = 6): Promise<AsxCompany[]> {
  const [live, host] = await Promise.all([
    sources.live(query, signal).catch(() => [] as AsxCompany[]),
    sources.host(query).catch(() => [] as InstrumentSearchResult[]),
  ]);
  if (signal.aborted) return [];
  const byCode = new Map(live.map((company) => [company.code, company]));
  const hostOnly: AsxCompany[] = [];
  for (const result of host) {
    const code = asxCodeFromSymbol(result.symbol, result.exchange);
    if (!code) continue;
    const known = byCode.get(code);
    // The host's mixed-case name reads better than ASX's capitals.
    const name = result.name?.trim() || known?.name || code;
    if (known) {
      byCode.set(code, { ...known, name });
    } else if (!hostOnly.some((company) => company.code === code)) {
      hostOnly.push({ code, name, industryGroup: /etf/i.test(result.type) ? "ETF" : null, listedOn: null, marketCap: null });
    }
  }
  const directory = new Map((cachedAsxDirectory() ?? []).map((company) => [company.code, company]));
  const enriched = await Promise.all(hostOnly.map(async (company, index) => {
    const listed = directory.get(company.code);
    if (listed) return { ...company, industryGroup: listed.industryGroup, marketCap: listed.marketCap };
    if (index >= MAX_LOOKUPS) return company;
    const found = await sources.lookup(company.code).catch(() => null);
    return found ? { ...company, industryGroup: found.industryGroup ?? company.industryGroup, marketCap: found.marketCap } : company;
  }));
  if (signal.aborted) return [];
  const merged = [...byCode.values(), ...enriched];
  if (merged.length > 0) return rankAsxListings(query, merged).slice(0, limit);
  // Neither search answered: the directory and tradable list.
  const all = await sources.lists();
  if (signal.aborted || all.length === 0) return [];
  return searchAsxDirectory(all, query, limit);
}

const lookups = new Map<string, Promise<AsxCompany | null>>();

/** ASX's row for one code, kept for the session: a listing's name and size do not change keystroke to keystroke. */
function lookupAsxCode(code: string): Promise<AsxCompany | null> {
  const cached = lookups.get(code);
  if (cached) return cached;
  const pending = searchAsx(code).then((rows) => rows.find((row) => row.code === code) ?? null);
  pending.catch(() => lookups.delete(code));
  if (lookups.size >= 500) lookups.delete(lookups.keys().next().value!);
  lookups.set(code, pending);
  return pending;
}

async function directoryAndFunds(): Promise<AsxCompany[]> {
  // These lists are shared and cached; a keystroke's abort must not cancel them for everyone.
  const [companies, funds] = await Promise.all([
    loadAsxDirectory().catch(() => [] as AsxCompany[]),
    loadAsxFunds().catch(() => [] as AsxCompany[]),
  ]);
  const listed = new Set(companies.map((company) => company.code));
  return [...companies, ...funds.filter((fund) => !listed.has(fund.code))];
}

/**
 * "ASX Listings" rows in the command bar: companies, ETFs and funds. The
 * host's own search ranks some ASX codes below same-named foreign listings
 * (VAS), so this section always offers the ASX line.
 */
export function createAsxSearchProvider(ctx: Pick<GloomPluginContext, "pinTicker" | "marketData">): CommandBarSearchProvider {
  const row = (company: AsxCompany) => ({
    id: `asx:${company.code}`,
    label: company.name,
    badge: company.code,
    detail: company.industryGroup ?? undefined,
    right: formatCap(company.marketCap),
    execute: () => ctx.pinTicker(asxSymbol(company.code)),
  });
  const sources: AsxListingSources = {
    live: searchAsx,
    // The same request as the host's Instruments section, so its cache answers it.
    host: (query) => ctx.marketData.search(query, { preferBroker: true, interactive: true }),
    lookup: lookupAsxCode,
    lists: directoryAndFunds,
  };
  return {
    id: "au-markets:asx-companies",
    category: "ASX Listings",
    // Below the host's own instrument rows: this section fills ranking gaps, it does not replace them.
    priority: 200,
    minQueryLength: 2,
    debounceMs: 250,
    async provide(query, _context, signal) {
      return (await findAsxListings(query, sources, signal)).map(row);
    },
  };
}
