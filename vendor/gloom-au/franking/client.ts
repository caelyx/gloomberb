import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectString, nullableNumber, nullableString, type Cached, type DiskCodec } from "../shared/disk-cache";
import { fetchJson } from "../shared/http";
import { parseKeyStatistics, type DividendKind, type FrankingSnapshot } from "./model";

const KEY_STATISTICS_URL = "https://asx.api.markitdigital.com/asx-research/1.0/companies";

const KINDS: readonly DividendKind[] = ["final", "interim", "special", "other"];

/** Stored as the object itself, checked field by field on the way back. */
export const frankingCodec: DiskCodec<FrankingSnapshot, FrankingSnapshot> = {
  encode: (snapshot) => snapshot,
  decode: (stored) => {
    if (!stored || typeof stored !== "object" || !KINDS.includes(stored.kind)) throw new Error("Cached franking entry is not recognised");
    return {
      code: expectString(stored.code, "code"),
      amount: nullableNumber(stored.amount, "amount"),
      declaredCurrency: nullableString(stored.declaredCurrency, "currency"),
      declaredAmount: nullableNumber(stored.declaredAmount, "declared amount"),
      kind: stored.kind,
      frankingPercent: nullableNumber(stored.frankingPercent, "franking"),
      exDate: nullableString(stored.exDate, "ex date"),
      recordDate: nullableString(stored.recordDate, "record date"),
      payDate: nullableString(stored.payDate, "pay date"),
      annualYield: nullableNumber(stored.annualYield, "yield"),
    };
  },
};

/** One entry per code, kept on disk so portfolio columns fill at startup; see CACHE_POLICY.franking. */
const cache = createDiskCache(CACHE_POLICY.franking, frankingCodec);

/** The snapshot with its age, and the reason when a refresh failed under a cached copy. */
export function loadFrankingCached(code: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<Cached<FrankingSnapshot>> {
  const normalized = code.trim().toUpperCase();
  return cache.load(normalized, async (signal) => (
    parseKeyStatistics(await fetchJson<unknown>(`${KEY_STATISTICS_URL}/${encodeURIComponent(normalized)}/key-statistics`, signal), normalized)
  ), options);
}

export async function loadFranking(code: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<FrankingSnapshot> {
  return (await loadFrankingCached(code, options)).data;
}

/** What is cached for a code, without fetching: for synchronous renderers such as list columns. */
export function peekFranking(code: string): { snapshot: FrankingSnapshot | null; fresh: boolean } {
  const cached = cache.peek(code.trim().toUpperCase());
  return { snapshot: cached?.data ?? null, fresh: !!cached && !cached.stale };
}
