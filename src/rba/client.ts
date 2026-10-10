import type { PluginPersistence } from "gloomberb/types/plugin";
import { createPluginCache, httpFetch, type PluginCacheResult } from "gloomberb/utils";
import { acgbSnapshot, type AcgbSnapshot, type CurveSession } from "./curve";
import { parseF16 } from "./f16";
import { parseTreasuryCsv, sessionOnOrBefore, TREASURY_HOST, treasuryCsvUrl } from "../ust/treasury";
import { PLUGIN_VERSION } from "../version";

const RBA_HOST = "www.rba.gov.au";
const F16_URL = `https://${RBA_HOST}/statistics/tables/csv/f16-data.csv`;
/** Every host the plugin fetches from, for the `hosts` field of the manifest. */
export const PLUGIN_HOSTS: readonly string[] = [RBA_HOST, TREASURY_HOST];

/**
 * Required: the RBA's CDN answers Bun's default `Bun/x.y.z` with 403 Access
 * Denied. Gloomberb's desktop and web proxies forward this header upstream.
 */
export const USER_AGENT = `gloom-acgb/${PLUGIN_VERSION}`;

const HOUR = 3_600_000;
/**
 * The RBA republishes F16 once a week, so most checks find the same file; a
 * snapshot is kept a month so the pane still has a curve offline.
 */
const SNAPSHOT_POLICY = { staleMs: 6 * HOUR, expireMs: 30 * 24 * HOUR };
const SNAPSHOT_KEY = "latest";

/** The curve the pane shows, read from the file as published now. */
export async function fetchSnapshot(): Promise<AcgbSnapshot> {
  const response = await httpFetch(F16_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Australian bond yield file request failed with HTTP ${response.status}`);
  const snapshot = acgbSnapshot(parseF16(await response.text()));
  if (!snapshot) throw new Error("Australian bond yield file has no quoted session");
  return snapshot;
}

async function fetchTreasuryYear(year: number): Promise<CurveSession[]> {
  const response = await httpFetch(treasuryCsvUrl(year), { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`US Treasury curve request failed with HTTP ${response.status}`);
  return parseTreasuryCsv(await response.text());
}

/** The US par curve on `date`, or the last US session before it; early January can reach into last year's file. */
export async function fetchUsCurve(date: string): Promise<CurveSession> {
  const year = Number(date.slice(0, 4));
  let sessions = await fetchTreasuryYear(year);
  let session = sessionOnOrBefore(sessions, date);
  if (!session && date.slice(5, 7) === "01") {
    sessions = [...await fetchTreasuryYear(year - 1), ...sessions];
    session = sessionOnOrBefore(sessions, date);
  }
  if (!session) throw new Error(`No US Treasury curve on or shortly before ${date}`);
  return session;
}

/** Cache-first: the network is reached on a miss, once the snapshot is stale, or on demand. */
export class AcgbService {
  private readonly cache = createPluginCache<AcgbSnapshot>({ kind: "acgb-snapshot", source: "rba-f16", policy: SNAPSHOT_POLICY });
  /** Keyed by the ACGB session it is drawn beside; a past US session does not change once published. */
  private readonly usCache = createPluginCache<CurveSession>({ kind: "ust-curve", source: "treasury-par", policy: SNAPSHOT_POLICY });

  attach(persistence: PluginPersistence): void {
    this.cache.attach(persistence);
    this.usCache.attach(persistence);
  }

  reset(): void {
    this.cache.reset();
    this.usCache.reset();
  }

  /** The last snapshot stored, however old, to show while the first load runs. */
  cached(): PluginCacheResult<AcgbSnapshot> | null {
    return this.cache.get(SNAPSHOT_KEY, { allowExpired: true });
  }

  load({ force = false } = {}): Promise<PluginCacheResult<AcgbSnapshot>> {
    return this.cache.load(SNAPSHOT_KEY, fetchSnapshot, { force });
  }

  loadUsCurve(date: string, { force = false } = {}): Promise<PluginCacheResult<CurveSession>> {
    return this.usCache.load(date, () => fetchUsCurve(date), { force });
  }
}
