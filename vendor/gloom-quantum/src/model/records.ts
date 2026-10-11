// Computes the Records table from the dataset and the registry (brief §4).
import type { Dataset, Device, Result } from "../schema";
import { inLookback, type LookbackYears } from "./lookback";
import { isInScope, REGISTRY, type Measured, type MetricDef, type RecordFlag, type RecordSection } from "./registry";

export interface RecordOptions {
  lookback: LookbackYears;
  today: string;
}

export interface RecordHolder {
  resultId: string;
  deviceId: string;
  date: string;
  value: number;
  /** Index into `result.logical` for logical-qubit metrics. */
  logicalIndex?: number;
  flags: RecordFlag[];
}

export interface RecordRow {
  metricId: string;
  label: string;
  section: RecordSection;
  group: string | null;
  /** Empty when nothing in the window is eligible. Several when tied under `show_all`. */
  holders: RecordHolder[];
  /** The best press-only value, when the metric shows claims and it beats the record. */
  claimed: RecordHolder | null;
}

interface Candidate extends RecordHolder {
  group: string | null;
  pressOnly: boolean;
  tieBreak?: number;
}

function asMeasured(measured: number | Measured | null): Measured | null {
  if (measured === null) return null;
  return typeof measured === "number" ? { value: measured } : measured;
}

function candidates(metric: MetricDef, results: Result[], devices: Map<string, Device>): Candidate[] {
  const models = metric.computeModels ?? ["gate"];
  const out: Candidate[] = [];
  for (const result of results) {
    const device = devices.get(result.device);
    // An out-of-scope model (annealing) holds nothing, whatever a metric lists (data/README.md rule 20).
    if (!device || result.status !== "active" || !models.includes(device.compute_model)
      || !isInScope(device.compute_model)) continue;
    const pressOnly = result.evidence === "press_only";
    const base = { resultId: result.id, deviceId: device.id, date: result.date_primary, pressOnly };
    const push = (measured: Measured | null, group: string | null, logicalIndex?: number) => {
      if (!measured || !Number.isFinite(measured.value)) return;
      const flags = [...(measured.flags ?? [])];
      if (pressOnly) flags.push("press_only");
      out.push({ ...base, value: measured.value, flags, group, ...(logicalIndex === undefined ? {} : { logicalIndex }),
        ...(measured.tieBreak === undefined ? {} : { tieBreak: measured.tieBreak }) });
    };
    if (metric.scope === "result") {
      push(asMeasured(metric.measure(result, device)), metric.groupBy?.(result, device) ?? null);
    } else {
      (result.logical ?? []).forEach((entry, index) => {
        if (metric.eligible && !metric.eligible(entry)) return;
        push(asMeasured(metric.measure(entry)), metric.groupBy?.(entry) ?? null, index);
      });
    }
  }
  return out;
}

function better(metric: MetricDef, a: number, b: number): boolean {
  return metric.direction === "max" ? a > b : a < b;
}

function best(metric: MetricDef, pool: Candidate[]): Candidate[] {
  if (pool.length === 0) return [];
  const top = pool.reduce((winner, c) => (better(metric, c.value, winner.value) ? c : winner)).value;
  const level = pool.filter((c) => c.value === top);
  // A secondary key (block size for code distance): larger wins; equal keys stay tied.
  const second = Math.max(...level.map((c) => c.tieBreak ?? -Infinity));
  const seen = new Set<string>();
  const tied = level
    .filter((c) => (c.tieBreak ?? -Infinity) === second)
    .sort((a, b) => b.date.localeCompare(a.date) || a.resultId.localeCompare(b.resultId))
    // A result holds a record once, by its first qualifying logical entry.
    .filter((c) => !seen.has(c.resultId) && seen.add(c.resultId));
  return metric.tieBreak === "latest" ? tied.slice(0, 1) : tied;
}

function holder({ group: _group, pressOnly: _pressOnly, tieBreak: _tieBreak, ...rest }: Candidate): RecordHolder {
  return rest;
}

export function resultsInWindow(dataset: Dataset, options: RecordOptions): Result[] {
  return dataset.results.filter((r) => inLookback(r.date_primary, options.lookback, options.today));
}

export function computeRecords(
  dataset: Dataset,
  options: RecordOptions,
  registry: readonly MetricDef[] = REGISTRY,
): RecordRow[] {
  const devices = new Map(dataset.devices.map((d) => [d.id, d]));
  const results = resultsInWindow(dataset, options);
  const rows: RecordRow[] = [];
  for (const metric of registry) {
    const all = candidates(metric, results, devices);
    const groups = metric.groupBy ? [...new Set(all.map((c) => c.group))].sort() : [null];
    for (const group of groups) {
      const pool = all.filter((c) => c.group === group);
      const verified = pool.filter((c) => !c.pressOnly);
      const eligible = metric.evidence === "any" ? pool : verified;
      const holders = best(metric, eligible);
      let claimed: Candidate | null = null;
      if (metric.showClaimed) {
        const claim = best(metric, pool.filter((c) => c.pressOnly))[0];
        if (claim && (holders.length === 0 || better(metric, claim.value, holders[0]!.value))) claimed = claim;
      }
      rows.push({
        metricId: metric.id,
        label: metric.label,
        section: metric.section,
        group,
        holders: holders.map(holder),
        claimed: claimed && holder(claimed),
      });
    }
  }
  return rows;
}

/** Disputed results in the window: listed in Records, never ranked (D8). */
export function disputedResults(dataset: Dataset, options: RecordOptions): Result[] {
  return resultsInWindow(dataset, options).filter((r) => r.status === "disputed");
}
