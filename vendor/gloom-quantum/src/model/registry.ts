// The declarative Records registry (brief §4). One entry per record; adding a
// record is adding an entry. Every metric also requires `status: active`;
// unless stated, `evidence: verified_primary` and `compute_model: gate`.
import type { CodeFamily, ComputeModel, Device, Logical, Result } from "../schema";
import { opsWithinT2, perLogicalQubitCycleError, registerWide2q } from "./derived";

export type RecordSection = "gate" | "non_gate";

/** Readable names for the modality ids, for panes and reports alike. */
export const MODALITY_LABELS: Record<string, string> = {
  superconducting: "Superconducting",
  trapped_ion: "Trapped ion",
  neutral_atom: "Neutral atom",
  spin_semiconductor: "Spin (semiconductor)",
  photonic: "Photonic",
  topological: "Topological",
  other: "Other",
};

/** Annotations a pane shows beside a record value. */
export type RecordFlag =
  | "press_only"
  | "t2_dd_fallback"
  | "extrapolated"
  | "normalised_by_k";

export interface Measured {
  value: number;
  flags?: RecordFlag[];
  /** Breaks ties on `value`: the larger wins, whatever the metric's direction. */
  tieBreak?: number;
}

/** How a metric's value is displayed: counts, error fractions, seconds, plain ratios or a code distance. */
export type MetricUnit = "count" | "error" | "time" | "ratio" | "distance";

interface MetricBase {
  id: string;
  label: string;
  unit: MetricUnit;
  section: RecordSection;
  direction: "max" | "min";
  tieBreak: "latest" | "show_all";
  /** Compute models whose results are eligible. Default: gate only. */
  computeModels?: readonly ComputeModel[];
  /** `any` admits press-only rows (flagged); default verified only. */
  evidence?: "verified" | "any";
  /** Also report the best press-only value when it beats the verified record. */
  showClaimed?: boolean;
}

export interface ResultMetric extends MetricBase {
  scope: "result";
  measure: (result: Result, device: Device) => number | Measured | null;
  groupBy?: (result: Result, device: Device) => string;
}

export interface LogicalMetric extends MetricBase {
  scope: "logical";
  eligible?: (entry: Logical) => boolean;
  measure: (entry: Logical) => number | Measured | null;
  groupBy?: (entry: Logical) => string | null;
}

export type MetricDef = ResultMetric | LogicalMetric;

const SURFACE_LIKE: readonly CodeFamily[] = ["surface", "toric", "colour_2d"];
/** Classical repetition codes: they suppress one error type only (bit or phase flips). */
const REPETITION: readonly CodeFamily[] = ["repetition", "cat_repetition"];
/**
 * Annealers are out of scope (data/README.md rule 20): they cannot run Shor's algorithm, and
 * factoring as optimisation on an annealer has no known scaling advantage, so no annealer is a
 * cryptanalytic threat measure. Their curated rows are kept and shown in Devices, in a section
 * of their own, but hold no record, get no Estimates gap and are never plotted.
 */
export const OUT_OF_SCOPE_MODELS: readonly ComputeModel[] = ["annealing"];
export const isInScope = (model: ComputeModel) => !OUT_OF_SCOPE_MODELS.includes(model);
/** Every in-scope compute model. */
const ALL_MODELS: readonly ComputeModel[] = ["gate", "analog", "boson_sampling", "array_no_gates", "other"];

// GKP entries carry no `distance` (no integer code distance): they are neither
// distance >= 3 nor distance 2, so they hold no corrected or detected count.
export const isCorrected = (l: Logical) =>
  l.distance !== undefined && l.distance >= 3 && l.protection_type !== "detection_postselect";
export const isDetected = (l: Logical) => l.protection_type === "detection_postselect" || l.distance === 2;

/** Block size n of "[[n,k,d]]" or "[[n,k,(dX,dZ)]]"; null for free-text (GKP) params. */
export function blockSize(codeParams: string): number | null {
  const match = /^\[\[(\d+),/.exec(codeParams);
  return match ? Number(match[1]) : null;
}

function longestT2(result: Result): Measured | null {
  const echo = result.t2_echo?.v;
  const value = echo ?? result.t2_dd?.v;
  if (value === undefined) return null;
  const flags: RecordFlag[] = [];
  if (echo === undefined) flags.push("t2_dd_fallback");
  if (result.t2_measured_to !== undefined && result.t2_measured_to < value) flags.push("extrapolated");
  return { value, flags };
}

export const REGISTRY: readonly MetricDef[] = [
  { id: "max_qubits_gate", label: "Programmable qubits", unit: "count", section: "gate", scope: "result", direction: "max",
    tieBreak: "show_all", showClaimed: true, measure: (r) => r.qubits_programmable ?? null },
  { id: "max_logical_corrected", label: "Logical qubits, error-corrected", unit: "count", section: "gate", scope: "logical",
    direction: "max", tieBreak: "latest", eligible: isCorrected, measure: (l) => l.n_logical },
  { id: "max_logical_detected", label: "Logical qubits, error-detected", unit: "count", section: "gate", scope: "logical",
    direction: "max", tieBreak: "latest",
    eligible: isDetected,
    measure: (l) => l.n_logical },
  { id: "max_logical_repeated_lambda", label: "Logical qubits, repeated QEC, Λ>1", unit: "count", section: "gate",
    scope: "logical", direction: "max", tieBreak: "show_all",
    eligible: (l) => l.protection_type === "correction_repeated" && (l.lambda?.v ?? 0) > 1
      && !REPETITION.includes(l.code_family),
    measure: (l) => l.n_logical },
  // An isolated-RB median excludes crosstalk, so it never holds the register-wide record.
  { id: "min_err_2q_register", label: "2Q error, register-wide", unit: "error", section: "gate", scope: "result",
    direction: "min", tieBreak: "show_all", measure: (r) => registerWide2q(r)?.v ?? null },
  { id: "min_err_2q_best_pair", label: "2Q error, single pair", unit: "error", section: "gate", scope: "result",
    direction: "min", tieBreak: "show_all", measure: (r) => r.err_2q_best_pair?.v ?? null },
  { id: "max_lambda", label: "Λ (surface, toric, 2D colour)", unit: "ratio", section: "gate", scope: "logical",
    direction: "max", tieBreak: "show_all",
    eligible: (l) => SURFACE_LIKE.includes(l.code_family) && l.lambda_basis !== undefined,
    measure: (l) => l.lambda?.v ?? null },
  { id: "min_logical_error_per_lq_cycle", label: "Logical error per LQ per cycle", unit: "error", section: "gate",
    scope: "logical", direction: "min", tieBreak: "show_all",
    eligible: (l) => l.protection_type === "correction_repeated",
    measure: (l) => {
      const per = perLogicalQubitCycleError(l);
      return per && { value: per.value, flags: per.normalised ? ["normalised_by_k"] : [] };
    } },
  { id: "longest_t2_by_modality", label: "Longest T2", unit: "time", section: "gate", scope: "result", direction: "max",
    tieBreak: "show_all", computeModels: ALL_MODELS, measure: longestT2, groupBy: (_r, d) => d.modality },
  { id: "max_ops_within_t2", label: "2Q gates within T2 echo", unit: "ratio", section: "gate", scope: "result",
    direction: "max", tieBreak: "show_all", measure: (r) => opsWithinT2(r) },
  // Distance measures protection; a block count does not (40 [[7,1,3]] blocks are still distance 3).
  // Surface codes have their own Λ and logical records; GKP has no distance. Logical-memory chips
  // (compute_model other, e.g. AWS's cat-qubit chip) demonstrate codes too, so they are eligible.
  { id: "max_distance_by_family", label: "Highest code distance", unit: "distance", section: "gate",
    scope: "logical", direction: "max", tieBreak: "show_all", computeModels: ["gate", "other"],
    eligible: (l) => isCorrected(l) && l.code_family !== "surface",
    measure: (l) => ({ value: l.distance!, tieBreak: blockSize(l.code_params) ?? undefined }),
    groupBy: (l) => l.code_family },
  { id: "max_qubits_analog", label: "Analogue qubits", unit: "count", section: "non_gate", scope: "result", direction: "max",
    tieBreak: "show_all", computeModels: ["analog"], evidence: "any",
    measure: (r) => r.qubits_analog ?? null },
  // Boson samplers store their mode count in qubits_analog; modes are not qubits.
  { id: "max_modes_boson_sampling", label: "Boson-sampling modes", unit: "count", section: "non_gate", scope: "result",
    direction: "max", tieBreak: "show_all", computeModels: ["boson_sampling"], evidence: "any",
    measure: (r) => r.qubits_analog ?? null },
  { id: "max_atoms_no_gates", label: "Atoms trapped, no gates", unit: "count", section: "non_gate",
    scope: "result", direction: "max", tieBreak: "show_all", computeModels: ["array_no_gates"],
    evidence: "any", measure: (r) => r.atoms_trapped ?? null },
];
