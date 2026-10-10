import type { QuoteBatchResult } from "gloomberb/types/data-provider";
import { ASX_SECTORS } from "../board/model";
import { sectorForIndustryGroup, type GicsSector } from "./gics";

/**
 * The heatmap's universes, constituent sources and the arithmetic shared by
 * the pane and `fn HMA`. No React or network here.
 */

export type HeatmapUniverse = "asx50" | "asx200" | "sectors";
export const HEATMAP_UNIVERSES: readonly HeatmapUniverse[] = ["asx50", "asx200", "sectors"];
/** The ASX 50 is one quote batch; the ASX 200 is two. */
export const DEFAULT_UNIVERSE: HeatmapUniverse = "asx50";

/**
 * Where index membership comes from. TradingView's scanner tags each S&P/ASX
 * 200 member with its indices; the other choice ranks the ASX directory by
 * market cap, which approximates the index but is not it.
 */
export type ConstituentSource = "tradingview" | "market-cap";
export const DEFAULT_SOURCE: ConstituentSource = "tradingview";

export function toUniverse(value: unknown): HeatmapUniverse {
  return HEATMAP_UNIVERSES.find((universe) => universe === value) ?? DEFAULT_UNIVERSE;
}

export function toSource(value: unknown): ConstituentSource {
  return value === "market-cap" ? "market-cap" : DEFAULT_SOURCE;
}

export const UNIVERSE_SIZE: Record<Exclude<HeatmapUniverse, "sectors">, number> = { asx50: 50, asx200: 200 };

/**
 * The universe's name for the board actually shown: the index when the scan
 * supplied its members, "Top 50" when they were ranked by market cap, so a
 * ranking is never passed off as the S&P/ASX 50.
 */
export function universeLabel(universe: HeatmapUniverse, ranked: boolean): string {
  if (universe === "sectors") return "Sectors";
  return `${ranked ? "Top" : "ASX"} ${UNIVERSE_SIZE[universe]}`;
}

/** A constituent: from the index scan, or a directory company ranked by market cap. */
export interface Constituent {
  code: string;
  name: string;
  /** AUD. */
  marketCap: number | null;
  /** Only meaningful for scan members; every ranked company in a Top 50 list is "in" it. */
  inAsx50: boolean;
}

const ASX_CODE = /^[A-Z0-9]{3,6}$/;

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positive = (value: unknown) => {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
};

export const ASX200_INDEX = "ASX:XJO";
export const ASX50_INDEX = "ASX:XFL";

/**
 * Rows of TradingView's scan, `{ s: "ASX:BHP", d: [name, description,
 * market_cap_basic, indexes] }`. A row that is not an ASX listing or is not
 * tagged as an ASX 200 member is dropped.
 */
export function parseIndexScan(json: unknown): Constituent[] {
  if (!isRecord(json) || !Array.isArray(json.data)) throw new Error("Index scan format was not recognised");
  const members: Constituent[] = [];
  const seen = new Set<string>();
  for (const row of json.data) {
    if (!isRecord(row) || !Array.isArray(row.d)) continue;
    const [exchange, ticker] = str(row.s).split(":");
    const code = str(row.d[0]).toUpperCase() || (ticker ?? "").toUpperCase();
    if (exchange !== "ASX" || !ASX_CODE.test(code) || seen.has(code)) continue;
    const indexes = Array.isArray(row.d[3]) ? row.d[3].filter(isRecord).map((index) => str(index.proname)) : [];
    if (!indexes.includes(ASX200_INDEX)) continue;
    seen.add(code);
    members.push({ code, name: str(row.d[1]) || code, marketCap: positive(row.d[2]), inAsx50: indexes.includes(ASX50_INDEX) });
  }
  return members;
}

/** The directory fields the ranking and the tiles read. */
export interface Listing {
  code: string;
  name: string;
  industryGroup: string | null;
  marketCap: number | null;
}

/**
 * The largest companies with a GICS sector, as a stand-in for an index. Funds
 * and trusts without one are left out, and a company listed under two codes
 * (News Corp's NWS and NWSLV) counts once, under its shorter code.
 */
export function rankByMarketCap(listings: readonly Listing[], count: number): Constituent[] {
  const seen = new Set<string>();
  return listings
    .filter((listing) => listing.marketCap != null && sectorForIndustryGroup(listing.industryGroup) !== null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.code.length - b.code.length || a.code.localeCompare(b.code))
    .filter((listing) => {
      const key = `${listing.name.toUpperCase()}|${listing.marketCap}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count)
    .map((listing) => ({ code: listing.code, name: listing.name, marketCap: listing.marketCap, inAsx50: true }));
}

/** The quote fields a tile shows. */
export interface TileQuote {
  name: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  lastUpdated: number | null;
}

/** The host's batch results by target symbol; a symbol it could not quote is left out. */
export function quotesFromBatch(results: readonly QuoteBatchResult[]): Map<string, TileQuote> {
  const quotes = new Map<string, TileQuote>();
  for (const result of results) {
    const quote = result?.quote as unknown;
    if (!isRecord(quote) || !result.target?.symbol) continue;
    quotes.set(result.target.symbol.toUpperCase(), {
      name: str(quote.name) || null,
      price: finite(quote.price),
      changePercent: finite(quote.changePercent),
      marketCap: positive(quote.marketCap),
      lastUpdated: positive(quote.lastUpdated),
    });
  }
  return quotes;
}

/** One tile: a company, or a sector index on the Sectors board. */
export interface HeatmapAsset {
  /** What the ticker layer opens: `BHP.AX`, or `^AXFJ`. */
  symbol: string;
  /** The tile's label: an ASX code, or a short sector name. */
  label: string;
  name: string;
  price: number | null;
  /** Null when there is no move to show; a flat 0.00% would be invented. */
  changePercent: number | null;
  /** Market cap in AUD (a sector's is the sum of its companies'); the tile's area follows it. */
  size: number | null;
  sector: GicsSector | null;
  industryGroup: string | null;
  lastUpdated: number | null;
}

export const axSymbol = (code: string) => `${code}.AX`;

/**
 * A constituent's tile, or null without a quote: a tile with no price or move
 * says nothing a heatmap is for. Size is ASX's market cap from the directory,
 * then the scan's, then the quote's; ASX's changes daily, so tiles do not
 * resize on each quote.
 */
export function companyAsset(member: Constituent, listing: Listing | undefined, quote: TileQuote | undefined): HeatmapAsset | null {
  if (!quote) return null;
  return {
    symbol: axSymbol(member.code),
    label: member.code,
    name: quote.name ?? member.name,
    price: quote.price,
    changePercent: quote.changePercent,
    size: listing?.marketCap ?? member.marketCap ?? quote.marketCap,
    sector: sectorForIndustryGroup(listing?.industryGroup),
    industryGroup: listing?.industryGroup ?? null,
    lastUpdated: quote.lastUpdated,
  };
}

/** The S&P/ASX 200 sector indices with their GICS sector; the A-REIT index stands for Real Estate. */
export const SECTOR_INDICES: ReadonlyArray<{ symbol: string; label: string; sector: GicsSector }> = ASX_SECTORS.map((entry) => ({
  symbol: entry.symbol,
  label: entry.label,
  sector: entry.label === "A-REIT" ? "Real Estate" : entry.label as GicsSector,
}));

/**
 * The Sectors board: one tile per index, sized by the market cap of the
 * sector's companies among `ranked` (the largest 200); null when that is
 * unknown, and the pane then sizes them evenly.
 */
export function sectorIndexAssets(quotes: ReadonlyMap<string, TileQuote>, ranked: readonly Listing[] | null): HeatmapAsset[] {
  const capBySector = new Map<GicsSector, number>();
  for (const listing of ranked ?? []) {
    const sector = sectorForIndustryGroup(listing.industryGroup);
    if (sector && listing.marketCap) capBySector.set(sector, (capBySector.get(sector) ?? 0) + listing.marketCap);
  }
  return SECTOR_INDICES.flatMap((index) => {
    const quote = quotes.get(index.symbol);
    if (!quote) return [];
    return [{
      symbol: index.symbol,
      label: index.label,
      name: `S&P/ASX 200 ${index.label}`,
      price: quote.price,
      changePercent: quote.changePercent,
      size: capBySector.get(index.sector) ?? null,
      sector: index.sector,
      industryGroup: null,
      lastUpdated: quote.lastUpdated,
    }];
  });
}

/** Area grows with the square root of market cap, as on core's HM, so mid-caps have room beside BHP and CBA. */
export function tileWeight(size: number | null): number {
  return size != null && size > 0 ? Math.sqrt(size) : 0;
}

/**
 * Group tiles by sector only when most of the board's value has one; a board
 * whose sectors failed to load lays out flat rather than as one unlabelled block.
 */
export function canGroupBySector(assets: readonly HeatmapAsset[]): boolean {
  let total = 0;
  let classified = 0;
  const sectors = new Set<string>();
  for (const asset of assets) {
    const weight = tileWeight(asset.size);
    total += weight;
    if (asset.sector) {
      classified += weight;
      sectors.add(asset.sector);
    }
  }
  return sectors.size >= 2 && classified >= total / 2;
}

/** The move of a set of names weighted by market cap, over those that have both. */
export function capWeightedMove(assets: readonly HeatmapAsset[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const asset of assets) {
    if (asset.changePercent == null || !(asset.size != null && asset.size > 0)) continue;
    weight += asset.size;
    sum += asset.changePercent * asset.size;
  }
  return weight > 0 ? sum / weight : null;
}

export interface SectorSummary {
  /** Null for companies without a sector. */
  sector: GicsSector | null;
  assets: HeatmapAsset[];
  size: number;
  move: number | null;
  up: number;
  down: number;
}

/** One summary per sector, largest first; unclassified companies last. */
export function summarizeSectors(assets: readonly HeatmapAsset[]): SectorSummary[] {
  const buckets = new Map<GicsSector | null, HeatmapAsset[]>();
  for (const asset of assets) buckets.set(asset.sector, [...(buckets.get(asset.sector) ?? []), asset]);
  return [...buckets.entries()]
    .map(([sector, members]) => ({
      sector,
      assets: members,
      size: members.reduce((sum, asset) => sum + (asset.size ?? 0), 0),
      move: capWeightedMove(members),
      up: members.filter((asset) => (asset.changePercent ?? 0) > 0).length,
      down: members.filter((asset) => (asset.changePercent ?? 0) < 0).length,
    }))
    .sort((a, b) => Number(a.sector === null) - Number(b.sector === null) || b.size - a.size);
}

/** The best and worst movers, `count` each. */
export function topMovers(assets: readonly HeatmapAsset[], count: number): { gainers: HeatmapAsset[]; losers: HeatmapAsset[] } {
  const moved = assets.filter((asset) => asset.changePercent != null);
  const byMove = [...moved].sort((a, b) => b.changePercent! - a.changePercent!);
  return {
    gainers: byMove.filter((asset) => asset.changePercent! > 0).slice(0, count),
    losers: byMove.reverse().filter((asset) => asset.changePercent! < 0).slice(0, count),
  };
}
