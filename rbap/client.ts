import { cachedRbaTable, loadRbaTable } from "../rba/client";
import { isoDaysBefore, type RbaSeries } from "../rba/model";
import { CACHE_POLICY } from "../shared/cache-policy";
import { combineMeta, createDiskCache, expectArray, expectNumber, expectString, nullableNumber, nullableString, type CacheMeta, type Cached, type DiskCodec } from "../shared/disk-cache";
import { fetchJson } from "../shared/http";
import { nearestDate, parseIbFutures, type IbContract, type IbStrip } from "./model";

/** The JSON behind ASX's futures pages; it answers 400 without the chart size. */
const IB_FUTURES = "https://asx.api.markitdigital.com/asx-research/1.0/derivatives/interest-rate/IB/futures?days=1&height=179&width=179";

type StoredContract = [symbol: string, month: string, settlement: number, last: number | null, lastTradeOn: string | null, bid: number | null, ask: number | null, volume: number];

function encodeContract(entry: IbContract): StoredContract {
  return [entry.symbol, entry.month, entry.settlement, entry.last, entry.lastTradeOn, entry.bid, entry.ask, entry.volume];
}

function decodeContract(stored: unknown): IbContract {
  const [symbol, month, settlement, last, lastTradeOn, bid, ask, volume] = expectArray(stored, "IB contract");
  return {
    symbol: expectString(symbol, "IB symbol"),
    month: expectString(month, "IB month"),
    settlement: expectNumber(settlement, "IB settlement"),
    last: nullableNumber(last, "IB last"),
    lastTradeOn: nullableString(lastTradeOn, "IB last trade date"),
    bid: nullableNumber(bid, "IB bid"),
    ask: nullableNumber(ask, "IB ask"),
    volume: expectNumber(volume, "IB volume"),
  };
}

export const ibStripCodec: DiskCodec<IbStrip, [string, StoredContract[]]> = {
  encode: (strip) => [strip.settledOn, strip.contracts.map(encodeContract)],
  decode: (stored) => {
    const [settledOn, contracts] = expectArray(stored, "IB strip");
    return { settledOn: expectString(settledOn, "IB settlement date"), contracts: expectArray(contracts, "IB contracts").map(decodeContract) };
  },
};

/** A settled strip: month and settlement only, which is all a look-back needs. */
export type IbSnapshot = Array<Pick<IbContract, "month" | "settlement">>;

export const ibSnapshotCodec: DiskCodec<IbSnapshot, Array<[string, number]>> = {
  encode: (snapshot) => snapshot.map((entry) => [entry.month, entry.settlement]),
  decode: (stored) => expectArray(stored, "IB snapshot").map((entry) => {
    const [month, settlement] = expectArray(entry, "IB snapshot entry");
    return { month: expectString(month, "IB snapshot month"), settlement: expectNumber(settlement, "IB snapshot settlement") };
  }),
};

const stripCache = createDiskCache(CACHE_POLICY.ibFutures, ibStripCodec);
/** Keyed by settlement day. Kept only where the host persists plugin data (the app, not `fn`). */
const snapshotCache = createDiskCache(CACHE_POLICY.ibSnapshot, ibSnapshotCodec);

const LOOKBACKS = [{ label: "1W", days: 7 }, { label: "1M", days: 30 }, { label: "1Y", days: 365 }] as const;

export interface Lookback {
  label: string;
  settledOn: string;
  contracts: IbSnapshot;
}

export interface RbapLoad {
  strip: IbStrip;
  /** RBA table F1 (cash rate target and overnight cash rate); null when it failed. */
  f1: Map<string, RbaSeries> | null;
  lookbacks: Lookback[];
  errors: string[];
  meta: CacheMeta | null;
}

function lookbacks(settledOn: string): Lookback[] {
  if (!settledOn) return [];
  return LOOKBACKS.flatMap(({ label, days }) => {
    const date = nearestDate(isoDaysBefore(settledOn, days), (day) => day !== settledOn && snapshotCache.peek(day) !== null);
    const held = date ? snapshotCache.peek(date) : null;
    return date && held ? [{ label, settledOn: date, contracts: held.data }] : [];
  });
}

/** Keeps the strip as at its settlement day, once per day, for later look-backs. */
async function remember(strip: IbStrip): Promise<void> {
  if (!strip.settledOn || snapshotCache.peek(strip.settledOn)) return;
  await snapshotCache.load(strip.settledOn, async () => strip.contracts.map(({ month, settlement }) => ({ month, settlement })));
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type LoadOptions = { force?: boolean; signal?: AbortSignal };

/** Where the loader's data comes from; tests pass their own. */
export interface RbapSources {
  fetchStrip: (signal: AbortSignal) => Promise<unknown>;
  loadF1: (options: LoadOptions) => Promise<Cached<Map<string, RbaSeries>>>;
}

const SOURCES: RbapSources = {
  fetchStrip: (signal) => fetchJson<unknown>(IB_FUTURES, signal),
  loadF1: (options) => loadRbaTable("f1", options),
};

/** The futures strip (required) and table F1 (optional: without it the path starts from the front contract). */
export async function loadRbap(options: LoadOptions = {}, sources: RbapSources = SOURCES): Promise<RbapLoad> {
  const [strip, f1] = await Promise.all([
    stripCache.load("ib", async (signal) => parseIbFutures(await sources.fetchStrip(signal)), options),
    sources.loadF1(options).then((result) => ({ result, error: null }), (error: unknown) => ({ result: null, error })),
  ]);
  await remember(strip.data);
  return {
    strip: strip.data,
    f1: f1.result?.data ?? null,
    lookbacks: lookbacks(strip.data.settledOn),
    errors: f1.error ? [`Cash rate unavailable, so the path starts from the front contract: ${failure(f1.error)}`] : [],
    meta: combineMeta([{ label: "", meta: strip }, f1.result ? { label: "Cash rate", meta: f1.result } : null]),
  };
}

/** The copy on disk, for a pane's first paint. */
export function cachedRbap(): RbapLoad | null {
  const strip = stripCache.peek("ib");
  if (!strip) return null;
  const f1 = cachedRbaTable("f1");
  return {
    strip: strip.data,
    f1: f1?.data ?? null,
    lookbacks: lookbacks(strip.data.settledOn),
    errors: [],
    meta: combineMeta([{ label: "", meta: strip }, f1 ? { label: "Cash rate", meta: f1 } : null]),
  };
}
