// What the Landscape chart plots (brief §6), before any chart encoding.
// Guardrails (§10): only programmable qubits of gate-model results; best-pair
// and press-only values never join the main series; isolated-RB results are
// not plotted at all (data/README.md rule 18).
import type { Boundary, Dataset, Estimate, Lineage, Modality, Result } from "../schema";
import { isIsolated2q, worstChannel } from "./derived";
import { inLookback, type LookbackYears } from "./lookback";

export type YMetric = "err_2q_register" | "err_worst_channel";

export interface LandscapeOptions {
  yMetric: YMetric;
  lookback: LookbackYears;
  today: string;
  showBestPairOnly: boolean;
  showPressOnly: boolean;
}

export interface LandscapePoint {
  resultId: string;
  deviceId: string;
  deviceName: string;
  modality: Modality;
  date: string;
  qubits: number;
  error: number;
  errorKind: "register" | "worst_channel" | "best_pair";
}

export type OmitReason =
  | "not_gate_model"
  | "no_programmable_count"
  | "no_error_value"
  | "press_only_hidden"
  /** Only a single-pair 2Q error, and single-pair results are switched off. */
  | "best_pair_hidden"
  /** Its 2Q median was measured in isolation (crosstalk excluded): not comparable, and nothing stands in. */
  | "isolated_2q_method";

/** A lab's results joined by a line: register-wide results only, in qubit order. */
export interface LandscapeLineage {
  id: string;
  label: string;
  shortLabel: string;
  modality: Modality;
  points: LandscapePoint[];
}

export interface LandscapeModel {
  points: LandscapePoint[];
  bestPairOnly: LandscapePoint[];
  pressOnly: LandscapePoint[];
  estimates: Estimate[];
  boundaries: Boundary[];
  /** Lineages with at least two results on the chart (data/lineages.yaml). */
  lineages: LandscapeLineage[];
  /** Active results in the window that are not on the chart, and why. */
  omitted: { resultId: string; reason: OmitReason }[];
}

function yValue(result: Result, metric: YMetric): { error: number; kind: LandscapePoint["errorKind"] } | null {
  if (metric === "err_worst_channel") {
    const worst = worstChannel(result);
    return worst && { error: worst.value, kind: "worst_channel" };
  }
  if (result.err_2q_register) return { error: result.err_2q_register.v, kind: "register" };
  if (result.err_2q_best_pair) return { error: result.err_2q_best_pair.v, kind: "best_pair" };
  return null;
}

export function buildLandscape(dataset: Dataset, options: LandscapeOptions): LandscapeModel {
  const devices = new Map(dataset.devices.map((d) => [d.id, d]));
  const model: LandscapeModel = {
    points: [],
    bestPairOnly: [],
    pressOnly: [],
    estimates: dataset.estimates.map((e) => ({ ...e, points: [...e.points].sort((a, b) => a.p_phys - b.p_phys) })),
    boundaries: dataset.boundaries,
    lineages: [],
    omitted: [],
  };
  const results = dataset.results
    .filter((r) => r.status === "active" && inLookback(r.date_primary, options.lookback, options.today))
    .sort((a, b) => a.date_primary.localeCompare(b.date_primary) || a.id.localeCompare(b.id));

  for (const result of results) {
    const device = devices.get(result.device);
    const omit = (reason: OmitReason) => model.omitted.push({ resultId: result.id, reason });
    if (!device || device.compute_model !== "gate") { omit("not_gate_model"); continue; }
    if (result.qubits_programmable === undefined) { omit("no_programmable_count"); continue; }
    if (isIsolated2q(result)) { omit("isolated_2q_method"); continue; }
    const y = yValue(result, options.yMetric);
    if (!y) { omit("no_error_value"); continue; }
    const point: LandscapePoint = {
      resultId: result.id,
      deviceId: device.id,
      deviceName: device.name,
      modality: device.modality,
      date: result.date_primary,
      qubits: result.qubits_programmable,
      error: y.error,
      errorKind: y.kind,
    };
    if (result.evidence === "press_only") {
      if (options.showPressOnly) model.pressOnly.push(point);
      else omit("press_only_hidden");
    } else if (y.kind === "best_pair") {
      if (options.showBestPairOnly) model.bestPairOnly.push(point);
      else omit("best_pair_hidden");
    } else {
      model.points.push(point);
    }
  }
  model.lineages = lineages(dataset.lineages ?? [], model.points, devices);
  return model;
}

/**
 * Only the main series joins a line: single-pair and press-only values are
 * not comparable with it, and estimates are not results.
 */
function lineages(defs: Lineage[], points: LandscapePoint[], devices: Map<string, Dataset["devices"][number]>): LandscapeLineage[] {
  return defs.flatMap((lineage) => {
    const members = points
      .filter((p) => p.modality === lineage.modality && lineage.vendors.includes(devices.get(p.deviceId)?.vendor ?? ""))
      .sort((a, b) => a.qubits - b.qubits || a.error - b.error || a.resultId.localeCompare(b.resultId));
    if (members.length < 2) return [];
    return [{
      id: lineage.id, label: lineage.label, shortLabel: lineage.short_label ?? lineage.label,
      modality: lineage.modality, points: members,
    }];
  });
}
