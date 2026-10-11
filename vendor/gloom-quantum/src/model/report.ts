// Flat rows for the CLI and headless reports (and later the panes' tables).
// Values stay raw SI; display formatting happens at the edge (format.ts).
import type { Dataset, Estimate, Result } from "../schema";
import { gapTable, spacetimeVolume, type QubitsBasis } from "./estimates";
import { computeRecords, resultsInWindow, type RecordOptions } from "./records";
import { isIsolated2q, registerWide2q } from "./derived";
import { isCorrected, isDetected, isInScope, REGISTRY, type MetricUnit, type RecordFlag } from "./registry";

export interface DeviceRow {
  date: string;
  vendor: string;
  device: string;
  modality: string;
  computeModel: string;
  /** False for an annealer: it cannot run Shor's algorithm (data/README.md rule 20). Shown, never compared. */
  inScope: boolean;
  /** Programmable (gate-addressable) qubits only. */
  qubits: number | null;
  /** A non-gate count, never comparable with `qubits`: trapped atoms, analog or annealing qubits. */
  otherCount: { value: number; unit: "atoms" | "analog" | "modes" | "annealing" | "fabricated" } | null;
  err2q: number | null;
  /**
   * `best_pair` when only a single-pair value exists; `isolated` for a median measured edge by edge in
   * isolation (crosstalk excluded). Neither is ever shown as register-wide.
   */
  err2qBasis: "register" | "isolated" | "best_pair" | null;
  logicalCorrected: number | null;
  logicalDetected: number | null;
  lambda: number | null;
  codes: string;
  evidence: string;
  status: string;
  result: string;
}

function maxOf(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

export function deviceRows(dataset: Dataset, options: RecordOptions): DeviceRow[] {
  const devices = new Map(dataset.devices.map((d) => [d.id, d]));
  const vendors = new Map(dataset.vendors.map((v) => [v.id, v]));
  return resultsInWindow(dataset, options)
    .sort((a, b) => b.date_primary.localeCompare(a.date_primary) || a.id.localeCompare(b.id))
    .map((r) => {
      const device = devices.get(r.device);
      const logical = r.logical ?? [];
      // Same predicates as the Records registry: a GKP entry (no distance) is neither.
      const detected = logical.filter(isDetected);
      const corrected = logical.filter(isCorrected);
      return {
        date: r.date_primary,
        vendor: vendors.get(device?.vendor ?? "")?.name ?? device?.vendor ?? "",
        device: device?.name ?? r.device,
        modality: device?.modality ?? "",
        computeModel: device?.compute_model ?? "",
        inScope: device ? isInScope(device.compute_model) : true,
        qubits: r.qubits_programmable ?? null,
        otherCount: r.qubits_programmable !== undefined ? null
          : r.atoms_trapped !== undefined ? { value: r.atoms_trapped, unit: "atoms" as const }
          : r.qubits_analog !== undefined
            ? { value: r.qubits_analog, unit: device?.compute_model === "boson_sampling" ? "modes" as const : "analog" as const }
          : r.qubits_annealing !== undefined ? { value: r.qubits_annealing, unit: "annealing" as const }
          : r.qubits_fabricated !== undefined ? { value: r.qubits_fabricated, unit: "fabricated" as const }
          : null,
        err2q: r.err_2q_register?.v ?? r.err_2q_best_pair?.v ?? null,
        err2qBasis: r.err_2q_register ? (isIsolated2q(r) ? "isolated" : "register") : r.err_2q_best_pair ? "best_pair" : null,
        logicalCorrected: maxOf(corrected.map((l) => l.n_logical)),
        logicalDetected: maxOf(detected.map((l) => l.n_logical)),
        lambda: maxOf(logical.flatMap((l) => (l.lambda ? [l.lambda.v] : []))),
        codes: [...new Set(logical.map((l) => l.code_params))].join(" "),
        evidence: r.evidence,
        status: r.status,
        result: r.id,
      };
    });
}

export interface RecordReportRow {
  metric: string;
  label: string;
  section: string;
  group: string | null;
  unit: MetricUnit;
  value: number | null;
  vendor: string | null;
  device: string | null;
  date: string | null;
  flags: RecordFlag[];
  /** What qualifies the value, from the holder's own record: protection and rounds, method, Λ basis. */
  context: string | null;
  result: string | null;
  claimedValue: number | null;
  claimedResult: string | null;
}

const PROTECTION_SHORT: Record<string, string> = {
  detection_postselect: "detection",
  correction_single_round: "single round",
  correction_repeated: "repeated",
};

function recordContext(metricId: string, result: Result | undefined, logicalIndex: number | undefined): string | null {
  if (!result) return null;
  const entry = logicalIndex === undefined ? undefined : result.logical?.[logicalIndex];
  if (metricId === "max_lambda") return entry?.lambda_basis ?? null;
  if (metricId === "max_distance_by_family") return entry?.code_params ?? null;
  if (metricId.startsWith("max_logical_") && entry) {
    const parts = [
      entry.n_qec_rounds && entry.n_qec_rounds > 1
        ? `${PROTECTION_SHORT[entry.protection_type]}, ${entry.n_qec_rounds} rounds`
        : PROTECTION_SHORT[entry.protection_type],
      entry.logical_gates.includes("none_memory_only") ? "memory only" : "with logical gates",
      entry.postselect_fraction !== undefined ? `${Math.round(entry.postselect_fraction * 100)} % discarded` : null,
    ];
    return parts.filter(Boolean).join(", ");
  }
  if (metricId === "min_err_2q_register" || metricId === "min_err_2q_best_pair") {
    const parts = [result.err_2q_method === "other" ? result.err_2q_method_note : result.err_2q_method, result.gate_error_convention];
    const text = parts.filter(Boolean).join(", ");
    return text || null;
  }
  return null;
}

/**
 * A note shown with every row of a metric, whoever holds it: why a record is thin, not about one holder.
 * The registry has no per-metric description, so the note lives here (data/README.md, Records coverage).
 */
const METRIC_NOTES: Record<string, string> = {
  max_ops_within_t2: "few results report both inputs",
};

function withMetricNote(metricId: string, context: string | null): string | null {
  const note = METRIC_NOTES[metricId];
  if (!note) return context;
  return context ? `${context}; ${note}` : note;
}

export function recordRows(dataset: Dataset, options: RecordOptions): RecordReportRow[] {
  const devices = new Map(dataset.devices.map((d) => [d.id, d]));
  const vendors = new Map(dataset.vendors.map((v) => [v.id, v.name]));
  const units = new Map(REGISTRY.map((m) => [m.id, m.unit]));
  const results = new Map(dataset.results.map((r) => [r.id, r]));
  return computeRecords(dataset, options).flatMap((row): RecordReportRow[] => {
    const base = {
      metric: row.metricId,
      label: row.label,
      section: row.section,
      group: row.group,
      unit: units.get(row.metricId)!,
    };
    const claimed = {
      claimedValue: row.claimed?.value ?? null,
      claimedResult: row.claimed?.resultId ?? null,
    };
    if (row.holders.length === 0) {
      return [{ ...base, value: null, vendor: null, device: null, date: null, flags: [], context: withMetricNote(row.metricId, null), result: null, ...claimed }];
    }
    return row.holders.map((h, i) => ({
      ...base,
      value: h.value,
      vendor: vendors.get(devices.get(h.deviceId)?.vendor ?? "") ?? null,
      device: devices.get(h.deviceId)?.name ?? h.deviceId,
      date: h.date,
      flags: h.flags,
      context: withMetricNote(row.metricId, recordContext(row.metricId, results.get(h.resultId), h.logicalIndex)),
      result: h.resultId,
      ...(i === 0 ? claimed : { claimedValue: null, claimedResult: null }),
    }));
  });
}

export interface EstimateRow {
  estimate: string;
  label: string;
  target: string;
  codeAssumption: string;
  connectivity: string | null;
  qubitsAt1e3: number | null;
  qubitsAt1e4: number | null;
  runtimeAt1e3: number | null;
  /** Which of the figures above the paper states as upper bounds. */
  upperBounds: Array<"qubitsAt1e3" | "qubitsAt1e4" | "runtimeAt1e3">;
  spacetimeAt1e3: number | null;
  date: string;
}

function pointAt(estimate: Estimate, p: number) {
  return estimate.points.find((pt) => pt.p_phys === p);
}

/** Estimates as stated: only tabulated points, nothing interpolated. */
export function estimateRows(dataset: Dataset): EstimateRow[] {
  return dataset.estimates.map((e) => {
    const at3 = pointAt(e, 1e-3);
    const at4 = pointAt(e, 1e-4);
    const upperBounds: EstimateRow["upperBounds"] = [];
    if (at3?.qubits_bound === "upper") upperBounds.push("qubitsAt1e3");
    if (at4?.qubits_bound === "upper") upperBounds.push("qubitsAt1e4");
    if (at3?.runtime_bound === "upper") upperBounds.push("runtimeAt1e3");
    return {
      estimate: e.id,
      label: e.label ?? e.id,
      target: e.target,
      codeAssumption: e.code_assumption,
      connectivity: e.connectivity_assumption ?? null,
      qubitsAt1e3: at3?.qubits ?? null,
      qubitsAt1e4: at4?.qubits ?? null,
      runtimeAt1e3: at3?.runtime_s ?? null,
      spacetimeAt1e3: at3 ? spacetimeVolume(at3) : null,
      upperBounds,
      date: e.date_primary,
    };
  });
}

export interface GapRow {
  target: string;
  codeAssumption: string;
  estimate: string;
  device: string;
  result: string;
  deviceError: number;
  deviceQubits: number;
  errorGap: number;
  qubitsNeeded: number | null;
  qubitsBasis: QubitsBasis | null;
  qubitGap: number | null;
}

/**
 * One result per record-holding device: devices with any gate-section record
 * in the window, each represented by its result with the lowest register-wide
 * 2Q error (verified, active, not an isolated-RB median, stating programmable qubits). The record and the error can come from
 * different results of the same device (Willow's Λ paper vs its spec sheet).
 */
export function frontierResults(dataset: Dataset, options: RecordOptions): Result[] {
  const inWindow = resultsInWindow(dataset, options);
  const byId = new Map(inWindow.map((r) => [r.id, r]));
  const devices = new Set(
    computeRecords(dataset, options)
      .filter((r) => r.section === "gate")
      .flatMap((r) => r.holders.map((h) => byId.get(h.resultId)?.device ?? h.deviceId)),
  );
  const models = new Map(dataset.devices.map((d) => [d.id, d.compute_model]));
  const best = new Map<string, Result>();
  for (const r of inWindow) {
    const error = registerWide2q(r);
    const model = models.get(r.device);
    // An annealer is out of scope (data/README.md rule 20): it never gets a gap, even if one held a record.
    if (!model || !isInScope(model)) continue;
    if (!devices.has(r.device) || !error || r.status !== "active" || r.evidence !== "verified_primary") continue;
    // Without a programmable count there is no qubit gap: such a result never represents its device.
    if (r.qubits_programmable === undefined) continue;
    const current = best.get(r.device);
    if (!current || error.v < current.err_2q_register!.v) best.set(r.device, r);
  }
  return [...best.values()];
}

export function gapRows(dataset: Dataset, options: RecordOptions): GapRow[] {
  const devices = new Map(dataset.devices.map((d) => [d.id, d]));
  const results = frontierResults(dataset, options);
  const deviceOf = new Map(results.map((r) => [r.id, r.device]));
  return gapTable(results, dataset.estimates).map((g) => ({
    target: g.target,
    codeAssumption: g.codeAssumption,
    estimate: g.estimateId,
    device: devices.get(deviceOf.get(g.resultId) ?? "")?.name ?? g.resultId,
    result: g.resultId,
    deviceError: g.deviceError,
    deviceQubits: g.deviceQubits,
    errorGap: g.errorGap,
    qubitsNeeded: g.qubitsNeeded,
    qubitsBasis: g.qubitsBasis,
    qubitGap: g.qubitGap,
  }));
}

export interface DeviceFilter {
  verifiedOnly: boolean;
  /** Empty means every modality. */
  modalities: readonly string[];
}

export function filterDeviceRows(rows: DeviceRow[], filter: DeviceFilter): DeviceRow[] {
  return rows.filter((r) =>
    (!filter.verifiedOnly || (r.evidence === "verified_primary" && r.status !== "disputed"))
    && (filter.modalities.length === 0 || filter.modalities.includes(r.modality)));
}

export type DeviceSortColumn =
  | "date" | "vendor" | "device" | "qubits" | "err2q" | "logical" | "lambda" | "codes" | "evidence";

const DEVICE_SORT_VALUE: Record<DeviceSortColumn, (r: DeviceRow) => string | number | null> = {
  date: (r) => r.date,
  vendor: (r) => r.vendor,
  device: (r) => r.device,
  qubits: (r) => r.qubits,
  err2q: (r) => r.err2q,
  logical: (r) => r.logicalCorrected ?? r.logicalDetected,
  lambda: (r) => r.lambda,
  codes: (r) => r.codes || null,
  evidence: (r) => r.evidence,
};

function compare(a: string | number | null, b: string | number | null, direction: "asc" | "desc"): number {
  // Missing values sort last in either direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
  return direction === "asc" ? order : -order;
}

/** The Devices section that holds annealers, apart from every modality (data/README.md rule 20). */
export const OUT_OF_SCOPE_SECTION = "annealing_out_of_scope";

/**
 * Rows grouped by modality (most rows first), each group sorted by the chosen column. Out-of-scope
 * rows (annealers) form one section of their own, always last, so they never read as part of a modality.
 */
export function sectionDeviceRows(
  rows: DeviceRow[],
  sort: { columnId: DeviceSortColumn; direction: "asc" | "desc" },
): Array<{ section: string; rows: DeviceRow[] }> {
  const groups = new Map<string, DeviceRow[]>();
  for (const row of rows) {
    const key = row.inScope ? row.modality : OUT_OF_SCOPE_SECTION;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const value = DEVICE_SORT_VALUE[sort.columnId];
  const last = (key: string) => (key === OUT_OF_SCOPE_SECTION ? 1 : 0);
  return [...groups.entries()]
    .sort((a, b) => last(a[0]) - last(b[0]) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([section, group]) => ({
      section,
      rows: [...group].sort((a, b) => compare(value(a), value(b), sort.direction) || b.date.localeCompare(a.date)),
    }));
}
