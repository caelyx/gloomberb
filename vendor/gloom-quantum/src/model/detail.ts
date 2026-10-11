// The full record of one result, in the brief's fixed order (§4): identity,
// counts, errors, coherence, system, logical[], sources, notes. Dispute and
// confidence caveats are shown with the identity rather than at the end. Pure: panes
// render the sections; nothing here knows about the UI.
import { fmtCount, fmtError, fmtRuntime, fmtTime, type ErrorFormat } from "../format";
import type { Device, Estimate, Logical, Result, Value, Vendor } from "../schema";
import { sourceLabel } from "../sources";
import { isIsolated2q } from "./derived";
import { isInScope } from "./registry";

export interface DetailRow {
  label: string;
  value: string;
  /** The source's own qualifier (a Value note, a basis), shown beside the value. */
  detail?: string;
}

export interface DetailSection {
  title: string;
  rows: DetailRow[];
}

export type ValueKind = "error" | "time" | "ratio" | "count";

function base(v: number, kind: ValueKind, errorFormat: ErrorFormat): string {
  switch (kind) {
    case "error": return fmtError(v, errorFormat);
    case "time": return fmtTime(v);
    case "count": return fmtCount(v);
    case "ratio": return String(Number(v.toPrecision(3)));
  }
}

/** A Value with its uncertainty, bound, approximation and statistic, as the source gave them. */
export function fmtValue(value: Value, kind: ValueKind, errorFormat: ErrorFormat): string {
  const fmt = (v: number) => base(v, kind, errorFormat);
  let text = fmt(value.v);
  if (value.unc !== undefined) text += ` ± ${fmt(value.unc)}`;
  else if (value.unc_hi !== undefined && value.unc_lo !== undefined) text += ` +${fmt(value.unc_hi)}/−${fmt(value.unc_lo)}`;
  if (value.approx) text = `~${text}`;
  if (value.bound === "upper") text = `< ${text}`;
  if (value.bound === "lower") text = `> ${text}`;
  if (value.stat) text += ` (${value.stat})`;
  return text;
}

const readable = (s: string) => s.replaceAll("_", " ");

function valueRow(label: string, value: Value | undefined, kind: ValueKind, f: ErrorFormat): DetailRow[] {
  if (!value) return [];
  return [{ label, value: fmtValue(value, kind, f), ...(value.note ? { detail: value.note } : {}) }];
}

function textRow(label: string, value: string | number | undefined | null, detail?: string): DetailRow[] {
  if (value === undefined || value === null || value === "") return [];
  return [{ label, value: String(value), ...(detail ? { detail } : {}) }];
}

/** "EPLG (chain 100, average error)": the chain length and whether the source quotes a process or an average error. */
function eplgLabel(result: Result): string {
  const parts = [result.eplg_chain_len ? `chain ${result.eplg_chain_len}` : undefined,
    result.eplg_convention ? `${result.eplg_convention} error` : undefined].filter(Boolean);
  return parts.length ? `EPLG (${parts.join(", ")})` : "EPLG";
}

const yesNo = (b: boolean | undefined) => (b === undefined ? undefined : b ? "yes" : "no");

const PROTECTION: Record<Logical["protection_type"], string> = {
  detection_postselect: "detection with post-selection",
  correction_single_round: "single-round correction",
  correction_repeated: "repeated correction",
};

export const CODE_FAMILY: Record<string, string> = {
  surface: "surface", toric: "toric", colour_2d: "2D colour", colour_3d: "3D colour", steane_713: "Steane [[7,1,3]]",
  bacon_shor: "Bacon–Shor", iceberg_422_family: "iceberg", c4c6_concatenated: "C4/C6 concatenated",
  tesseract_1644: "tesseract", qldpc_bb: "qLDPC bivariate bicycle", qldpc_gb: "qLDPC generalised bicycle",
  qldpc_other: "qLDPC", helix_c4: "C4-Helix", repetition: "repetition", cat_repetition: "cat repetition",
  gkp: "GKP", floquet_honeycomb: "Floquet honeycomb", floquet_bacon_shor: "Floquet Bacon–Shor", dual_rail: "dual-rail",
};

const LOGICAL_GATE: Record<string, string> = {
  none_memory_only: "none (memory only)", transversal_clifford: "transversal Clifford", lattice_surgery: "lattice surgery",
  code_switching: "code switching", magic_injection: "magic-state injection", magic_distillation: "magic-state distillation",
  non_clifford_gate: "non-Clifford gate", algorithm_run: "algorithm run",
};

/** An enum value, or its note when the value is `other`. */
function named(value: string | undefined, note: string | undefined, names: Record<string, string> = {}): string | undefined {
  if (value === undefined) return undefined;
  if (value === "other") return note ?? "other";
  return names[value] ?? readable(value);
}

const DECODER: Record<string, string> = {
  offline_mwpm: "offline matching (MWPM)", offline_nn: "offline neural network", realtime_fpga: "real-time FPGA",
  realtime_gpu: "real-time GPU", none: "none",
};

const BASIS: Record<string, string> = {
  per_cycle_single_lq: "per cycle",
  per_lq_per_cycle: "per logical qubit per cycle",
  per_block_per_round: "per block per round",
  per_gate: "per gate",
  per_circuit: "per circuit",
};

function logicalSection(entry: Logical, index: number, f: ErrorFormat): DetailSection {
  const error = entry.logical_error
    ? `${fmtValue(entry.logical_error, "error", f)}${entry.logical_error_basis ? ` ${BASIS[entry.logical_error_basis]}` : ""}`
    : undefined;
  const family = named(entry.code_family, entry.code_family_note, CODE_FAMILY)!;
  return {
    // GKP parameters are free text that already names the code ("GKP qutrit").
    title: entry.code_params.startsWith("[[")
      ? `Logical ${index + 1}: ${entry.code_params} ${entry.code_family === "other" ? "code" : family}`
      : `Logical ${index + 1}: ${entry.code_params}`,
    rows: [
      ...(entry.code_family === "other" ? textRow("Code", family) : []),
      ...textRow("Distance", entry.distance ?? (entry.code_family === "gkp" ? "none (GKP code)" : undefined)),
      ...textRow("Logical qubits", entry.n_logical),
      ...textRow("Physical qubits", `${fmtCount(entry.n_physical_used)} (${entry.n_physical_basis === "data_only" ? "data qubits only" : "data and ancilla"})`),
      ...textRow("Protection", PROTECTION[entry.protection_type]),
      ...textRow("QEC rounds", entry.n_qec_rounds === undefined ? undefined : fmtCount(entry.n_qec_rounds)),
      ...textRow("Shots discarded", entry.postselect_fraction === undefined ? undefined : `${Number((entry.postselect_fraction * 100).toPrecision(3))} %`),
      ...textRow("Logical gates", entry.logical_gates.map((g) => named(g, entry.logical_gates_note, LOGICAL_GATE)).join(", "),
        entry.logical_gates.includes("other") ? undefined : entry.logical_gates_note),
      ...textRow("Logical error", error, entry.logical_error?.note),
      ...valueRow("Comparable physical error", entry.comparable_physical_error, "error", f),
      ...valueRow("Break-even ratio", entry.break_even_ratio, "ratio", f),
      ...(entry.lambda ? [{ label: "Λ", value: fmtValue(entry.lambda, "ratio", f), ...(entry.lambda_basis ? { detail: entry.lambda_basis } : {}) }] : []),
      ...textRow("Below threshold", yesNo(entry.below_threshold)),
      ...textRow("Decoder", named(entry.decoder, entry.decoder_note, DECODER), entry.decoder === "other" ? undefined : entry.decoder_note),
      ...textRow("Note", entry.note),
    ],
  };
}

export function resultDetailSections(
  result: Result,
  device: Device | undefined,
  vendor: Vendor | undefined,
  f: ErrorFormat,
): DetailSection[] {
  const date = result.date_journal ? `${result.date_primary} (journal ${result.date_journal})` : result.date_primary;
  const deviceName = device ? `${vendor ? `${vendor.name} ` : ""}${device.name}` : result.device;
  const modality = device ? [readable(device.modality), device.submodality && readable(device.submodality)].filter(Boolean).join(", ") : undefined;
  const sections: DetailSection[] = [
    {
      title: "Identity",
      rows: [
        ...textRow("Result", result.id),
        ...textRow("Device", deviceName),
        ...textRow("Modality", modality),
        ...(device && device.compute_model !== "gate"
          ? textRow("Compute model", readable(device.compute_model), device.compute_model_note) : []),
        // data/README.md rule 20: shown in Devices, never compared.
        ...(device && !isInScope(device.compute_model)
          ? textRow("Scope", "Out of scope: an annealer cannot run Shor's algorithm, so it is no cryptanalytic threat measure")
          : []),
        ...textRow("Date", date),
        ...textRow("Evidence", result.evidence === "press_only" ? "~ press release only" : "✓ primary source"),
        ...(result.status !== "active"
          ? textRow("Status", result.status === "disputed" ? "! disputed" : result.status) : []),
        ...textRow("Supersedes", result.supersedes),
        // Caveats sit with the identity, not at the end: they change how every number below reads.
        ...textRow("Dispute", result.dispute_note),
        ...textRow("Caveat", result.confidence_note),
      ],
    },
    {
      title: "Counts",
      rows: [
        ...textRow("Programmable qubits", result.qubits_programmable && fmtCount(result.qubits_programmable)),
        ...textRow("Fabricated elements", result.qubits_fabricated && fmtCount(result.qubits_fabricated)),
        ...textRow("Atoms trapped", result.atoms_trapped && fmtCount(result.atoms_trapped)),
        ...textRow("Qubits used here", result.qubits_used_in_result && fmtCount(result.qubits_used_in_result)),
        ...textRow(device?.compute_model === "boson_sampling" ? "Modes (boson sampling)" : "Analogue qubits",
          result.qubits_analog && fmtCount(result.qubits_analog)),
        ...textRow("Annealing qubits", result.qubits_annealing && fmtCount(result.qubits_annealing)),
      ],
    },
    {
      title: "Errors",
      rows: [
        // An isolated-RB median is stored, but it is not register-wide: its label says how it was measured.
        ...valueRow(isIsolated2q(result) ? "2Q error (isolated RB, not register-wide)" : "2Q error (register)",
          result.err_2q_register, "error", f),
        ...valueRow("2Q error (single pair)", result.err_2q_best_pair, "error", f),
        ...valueRow("2Q error (post-selected)", result.err_2q_postselected, "error", f),
        ...(result.err_2q_method
          ? textRow("2Q method", [result.err_2q_method,
            result.gate_error_convention && (result.gate_error_convention === "average" ? "average infidelity" : "Pauli error"),
          ].filter(Boolean).join(", "), result.err_2q_method_note)
          : textRow("Error convention", result.gate_error_convention && (result.gate_error_convention === "average" ? "average infidelity" : "Pauli error"))),
        ...valueRow("1Q error", result.err_1q, "error", f),
        ...valueRow("Readout error", result.err_readout, "error", f),
        ...valueRow("SPAM error", result.err_spam, "error", f),
        ...valueRow("Mid-circuit measurement error", result.err_midcircuit_meas, "error", f),
        ...valueRow("Leakage per gate", result.leakage_per_gate, "error", f),
        ...valueRow(eplgLabel(result), result.eplg, "error", f),
        ...valueRow(`Worst channel${result.worst_channel_name ? ` (${result.worst_channel_name})` : ""}`, result.err_worst_channel, "error", f),
      ],
    },
    {
      title: "Coherence and timing",
      rows: [
        ...valueRow("T1", result.t1, "time", f),
        ...valueRow("T2*", result.t2_star, "time", f),
        ...valueRow("T2 (echo)", result.t2_echo, "time", f),
        ...valueRow("T2 (dynamical decoupling)", result.t2_dd, "time", f),
        ...textRow("T2 probed to", result.t2_measured_to === undefined ? undefined : fmtTime(result.t2_measured_to)),
        ...valueRow("Bit-flip time (not T2)", result.t_bitflip, "time", f),
        ...valueRow("2Q gate time", result.gate_time_2q, "time", f),
        ...valueRow("1Q gate time", result.gate_time_1q, "time", f),
        ...valueRow("QEC cycle", result.qec_cycle_time, "time", f),
        ...valueRow("Readout time", result.readout_time, "time", f),
        ...valueRow("Decoder latency", result.decoder_latency, "time", f),
      ],
    },
    {
      title: "System",
      rows: [
        ...valueRow("Quantum volume", result.quantum_volume, "count", f),
        ...valueRow("CLOPS", result.clops, "count", f),
        ...valueRow("#AQ", result.aq, "count", f),
        ...textRow("Connectivity", named(result.connectivity, result.connectivity_note), result.connectivity === "other" ? undefined : result.connectivity_note),
        ...textRow("Mid-circuit feedforward", yesNo(result.midcircuit_feedforward)),
        ...textRow("Modules", result.modules),
        ...textRow("Decoder", named(result.decoder, result.decoder_note, DECODER), result.decoder === "other" ? undefined : result.decoder_note),
      ],
    },
    ...(result.logical ?? []).map((entry, i) => logicalSection(entry, i, f)),
    {
      title: "Sources",
      rows: result.sources.map((s, i) => ({
        label: String(i + 1),
        value: sourceLabel(s),
        detail: `opened ${s.opened}${s.note ? `; ${s.note}` : ""}`,
      })),
    },
    {
      title: "Notes",
      rows: textRow("Notes", result.notes),
    },
  ];
  return sections.filter((s) => s.rows.length > 0);
}

const TARGET: Record<string, string> = {
  rsa1024: "RSA-1024", rsa2048: "RSA-2048", rsa3072: "RSA-3072", rsa4096: "RSA-4096",
  ecc256: "ECC-256", femoco: "FeMoCo (chemistry)",
};

const CODE_ASSUMPTION: Record<string, string> = { surface: "surface", qldpc: "qLDPC" };

const CONNECTIVITY: Record<string, string> = {
  nearest_neighbour_2d: "nearest-neighbour 2D", long_range: "long-range (non-local)",
  reconfigurable_atoms: "reconfigurable atoms", all_to_all: "all-to-all",
};

/** Spacetime volume in Gidney's unit: physical qubits × days, in millions. */
export function megaqubitDays(qubits: number, runtimeS: number): number {
  return (qubits * runtimeS) / 86400 / 1e6;
}

function twoSig(v: number): string {
  return v >= 100 ? fmtCount(v) : String(Number(v.toPrecision(2)));
}

/** The full record of a resource estimate: what it assumes, then each point the paper states. */
export function estimateDetailSections(estimate: Estimate, f: ErrorFormat): DetailSection[] {
  const sections: DetailSection[] = [
    {
      title: "Assumptions",
      rows: [
        ...textRow("Estimate", estimate.label ?? estimate.id),
        ...textRow("Target", named(estimate.target, estimate.target_note, TARGET)),
        ...textRow("Code", named(estimate.code_assumption, estimate.code_assumption_note, CODE_ASSUMPTION), estimate.code_assumption === "other" ? undefined : estimate.code_assumption_note),
        ...textRow("Connectivity", named(estimate.connectivity_assumption, estimate.connectivity_assumption_note, CONNECTIVITY),
          estimate.connectivity_assumption === "other" ? undefined : estimate.connectivity_assumption_note),
        ...textRow("Decoder", estimate.decoder_assumption),
        ...textRow("Code cycle", estimate.cycle_time_s === undefined ? undefined : fmtTime(estimate.cycle_time_s)),
        ...textRow("Kind", estimate.kind === "curve"
          ? `curve through ${estimate.points.length} tabulated points (interpolated, never extrapolated)`
          : `${estimate.points.length === 1 ? "one stated point" : `${estimate.points.length} stated points (never joined)`}`),
        ...textRow("Published", estimate.date_primary),
      ],
    },
    ...[...estimate.points].sort((a, b) => b.p_phys - a.p_phys).map((p) => {
      const upper = (bound: string | undefined) => (bound === "upper" ? "≤ " : "");
      const volume = p.runtime_s === undefined ? undefined : megaqubitDays(p.qubits, p.runtime_s);
      return {
        title: `At ${fmtError(p.p_phys, f)} physical error`,
        rows: [
          ...textRow("Physical qubits", `${upper(p.qubits_bound)}${fmtCount(p.qubits)}`),
          ...textRow("Runtime", p.runtime_s === undefined ? undefined : `${upper(p.runtime_bound)}${fmtRuntime(p.runtime_s)}`),
          ...textRow("Spacetime volume", volume === undefined ? undefined
            : `${p.qubits_bound === "upper" || p.runtime_bound === "upper" ? "≤ " : ""}${twoSig(volume)} megaqubit-days`),
        ],
      };
    }),
    {
      title: "Notes",
      rows: [
        ...textRow("Assumptions", estimate.assumptions_note),
        ...textRow("Runtime", estimate.runtime_note),
      ],
    },
    {
      title: "Sources",
      rows: estimate.sources.map((s, i) => ({
        label: String(i + 1),
        value: sourceLabel(s),
        detail: `opened ${s.opened}${s.note ? `; ${s.note}` : ""}`,
      })),
    },
    {
      title: "How the gap is computed",
      rows: [
        { label: "Error gap", value: "device 2Q error ÷ worst error this estimate covers", detail: "≤ ×1 already meets it" },
        { label: "Qubit gap", value: "qubits needed at the device's error ÷ device qubits",
          detail: "n/a when the device's error is worse than the estimate covers; compared only within the same code assumption" },
      ],
    },
  ];
  return sections.filter((s) => s.rows.length > 0);
}
