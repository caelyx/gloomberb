import type { TickerFinancials } from "gloomberb/types/financials";
import type { CustomColumnDef } from "gloomberb/types/plugin";
import type { TickerRecord } from "gloomberb/types/ticker";
import { asxCodeForTicker } from "../shared/asx";
import { loadFrankingCached, peekFranking } from "./client";
import { grossedUpYield, type FrankingSnapshot } from "./model";

const RETRY_AFTER_MS = 30 * 60_000;
const failedUntil = new Map<string, number>();

/**
 * Columns render synchronously on every list repaint, so they read the cache
 * and start a fetch on a miss or a stale entry; the next repaint (any quote
 * tick) shows it. A stale value keeps showing meanwhile. A code whose fetch
 * or refresh failed waits before it is asked again.
 */
function snapshotFor(ticker: TickerRecord): FrankingSnapshot | null {
  const code = asxCodeForTicker(ticker);
  if (!code) return null;
  const { snapshot, fresh } = peekFranking(code);
  if (!fresh && (failedUntil.get(code) ?? 0) <= Date.now()) {
    failedUntil.set(code, Date.now() + RETRY_AFTER_MS);
    // A failed refresh over a cached copy resolves with that copy; it still waits out the back-off.
    loadFrankingCached(code).then((result) => { if (!result.refreshError) failedUntil.delete(code); }, () => {});
  }
  return snapshot;
}

function cashYield(financials: TickerFinancials | null, snapshot: FrankingSnapshot): number | null {
  const fromQuote = financials?.fundamentals?.dividendYield;
  return typeof fromQuote === "number" && Number.isFinite(fromQuote) ? fromQuote : snapshot.annualYield;
}

export const frankingPercentColumn: CustomColumnDef = {
  id: "au-franking",
  label: "FRANK%",
  width: 7,
  align: "right",
  render(ticker) {
    const snapshot = snapshotFor(ticker);
    return snapshot?.frankingPercent == null ? "" : `${Math.round(snapshot.frankingPercent)}%`;
  },
};

export const grossYieldColumn: CustomColumnDef = {
  id: "au-gross-yield",
  label: "GROSS YLD",
  width: 9,
  align: "right",
  render(ticker, financials) {
    const snapshot = snapshotFor(ticker);
    if (!snapshot) return "";
    const gross = grossedUpYield(cashYield(financials, snapshot), snapshot.frankingPercent);
    return gross == null ? "" : `${(gross * 100).toFixed(2)}%`;
  },
};
