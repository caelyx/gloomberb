// Types for the curated dataset, schema v1 (brief §3). tools/gen_schema.py is the
// authority and writes data/schema.json; these types mirror it. Enum lists come
// from the generated module so the two cannot drift. `tsc` checks
// src/data/generated.ts against these types. v1 is unreleased: it still changes
// without a version bump until the first release.
import type * as E from "./data/enums.generated";

type Of<T extends readonly string[]> = T[number];

export type Modality = Of<typeof E.MODALITIES>;
export type ComputeModel = Of<typeof E.COMPUTE_MODELS>;
export type SourceKind = Of<typeof E.SOURCE_KINDS>;
export type Evidence = Of<typeof E.EVIDENCE>;
export type Status = Of<typeof E.STATUSES>;
export type Stat = Of<typeof E.STATS>;
export type Err2qMethod = Of<typeof E.ERR_2Q_METHODS>;
export type WorstChannelName = Of<typeof E.WORST_CHANNEL_NAMES>;
export type Connectivity = Of<typeof E.CONNECTIVITIES>;
export type CodeFamily = Of<typeof E.CODE_FAMILIES>;
export type ProtectionType = Of<typeof E.PROTECTION_TYPES>;
export type LogicalGate = Of<typeof E.LOGICAL_GATES>;
export type LogicalErrorBasis = Of<typeof E.LOGICAL_ERROR_BASES>;
export type Decoder = Of<typeof E.DECODERS>;
export type EstimateTarget = Of<typeof E.ESTIMATE_TARGETS>;
export type CodeAssumption = Of<typeof E.CODE_ASSUMPTIONS>;
export type ConnectivityAssumption = Of<typeof E.CONNECTIVITY_ASSUMPTIONS>;
export type BoundaryId = Of<typeof E.BOUNDARY_IDS>;
export type NPhysicalBasis = Of<typeof E.N_PHYSICAL_BASES>;
export type GateErrorConvention = Of<typeof E.GATE_ERROR_CONVENTIONS>;
export type EplgConvention = Of<typeof E.EPLG_CONVENTIONS>;

/** ISO date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** One measurement, in SI units: errors as fractions, times in seconds (D16). */
export interface Value {
  v: number;
  unc?: number;
  unc_lo?: number;
  unc_hi?: number;
  bound?: Of<typeof E.BOUNDS>;
  approx?: boolean;
  stat?: Stat;
  note?: string;
}

/** A url/press `id` is stored without its scheme; add `https://` to open it. */
export interface Source {
  kind: SourceKind;
  /** arXiv ids carry their version ("2511.05465v1"); DOIs are bare. */
  id: string;
  title?: string;
  authors_short?: string;
  /** When the curator actually opened and read it. A DOI known only from the arXiv page goes in `note`. */
  opened: IsoDate;
  note?: string;
}

export interface Logical {
  code_family: CodeFamily;
  code_family_note?: string;
  /** "[[n,k,d]]" or "[[n,k,(dX,dZ)]]"; free text (e.g. "GKP qutrit") for code_family gkp only. */
  code_params: string;
  /** min(dX, dZ). Absent only for code_family gkp, which has no integer code distance. */
  distance?: number;
  n_logical: number;
  n_physical_used: number;
  /** Whether n_physical_used counts the code block only or data plus ancilla qubits. */
  n_physical_basis: NPhysicalBasis;
  protection_type: ProtectionType;
  n_qec_rounds?: number;
  /** Fraction of shots discarded. Often derived as 1 − a stated acceptance rate; `note` then says so. */
  postselect_fraction?: number;
  logical_gates: LogicalGate[];
  logical_gates_note?: string;
  logical_error?: Value;
  logical_error_basis?: LogicalErrorBasis;
  comparable_physical_error?: Value;
  break_even_ratio?: Value;
  lambda?: Value;
  lambda_basis?: string;
  below_threshold?: boolean;
  decoder?: Decoder;
  decoder_note?: string;
  note?: string;
}

export interface Result {
  id: string;
  device: string;
  date_primary: IsoDate;
  date_journal?: IsoDate;
  sources: Source[];
  evidence: Evidence;
  status: Status;
  supersedes?: string;
  dispute_note?: string;
  confidence_note?: string;
  /** Copied from a CC BY-SA source; the build keeps such rows in a separate module. */
  sa_derived?: boolean;

  qubits_programmable?: number;
  qubits_fabricated?: number;
  atoms_trapped?: number;
  qubits_used_in_result?: number;
  qubits_analog?: number;
  qubits_annealing?: number;

  err_2q_register?: Value;
  err_2q_method?: Err2qMethod;
  err_2q_method_note?: string;
  /** Average gate infidelity (RB) or Pauli error (XEB); for two qubits average = 4/5 × Pauli. */
  gate_error_convention?: GateErrorConvention;
  err_2q_best_pair?: Value;
  err_2q_postselected?: Value;
  err_1q?: Value;
  err_readout?: Value;
  err_spam?: Value;
  err_midcircuit_meas?: Value;
  leakage_per_gate?: Value;
  eplg?: Value;
  eplg_chain_len?: number;
  /** Process error (arXiv:2311.05933) or average gate error (IBM calibration pages, 4/5 × process). */
  eplg_convention?: EplgConvention;
  err_worst_channel?: Value;
  worst_channel_name?: WorstChannelName;

  t1?: Value;
  t2_star?: Value;
  t2_echo?: Value;
  t2_dd?: Value;
  /** Cat-qubit bit-flip time. Not a T2; never ranked with coherence. */
  t_bitflip?: Value;
  t2_measured_to?: number;
  gate_time_2q?: Value;
  gate_time_1q?: Value;
  qec_cycle_time?: Value;
  readout_time?: Value;

  quantum_volume?: Value;
  clops?: Value;
  aq?: Value;
  connectivity?: Connectivity;
  connectivity_note?: string;
  midcircuit_feedforward?: boolean;
  decoder_latency?: Value;
  decoder?: Decoder;
  decoder_note?: string;
  modules?: number;

  logical?: Logical[];
  notes?: string;
}

export interface Vendor {
  id: string;
  name: string;
  aliases?: string[];
  succession?: { from: string; to: string; date: string; note?: string }[];
}

export interface Device {
  id: string;
  vendor: string;
  name: string;
  modality: Modality;
  modality_note?: string;
  submodality?: string;
  compute_model: ComputeModel;
  compute_model_note?: string;
  species?: string;
  qubit_encoding?: string;
  first_public?: IsoDate;
  notes?: string;
}

export interface EstimatePoint {
  p_phys: number;
  /** Physical qubits. */
  qubits: number;
  runtime_s?: number;
  /** The paper states the figure as a bound ("fewer than", rounded up). */
  qubits_bound?: "upper";
  runtime_bound?: "upper";
}

export interface Estimate {
  id: string;
  label?: string;
  /** For the chart legend, at most 12 characters. */
  short_label?: string;
  target: EstimateTarget;
  target_note?: string;
  kind: Of<typeof E.ESTIMATE_KINDS>;
  sources: Source[];
  date_primary: IsoDate;
  code_assumption: CodeAssumption;
  code_assumption_note?: string;
  connectivity_assumption?: ConnectivityAssumption;
  connectivity_assumption_note?: string;
  decoder_assumption?: string;
  assumptions_note?: string;
  cycle_time_s?: number;
  runtime_note?: string;
  points: EstimatePoint[];
}

export interface Boundary {
  id: BoundaryId;
  kind: "hline" | "curve";
  label: string;
  short_label?: string;
  y?: number;
  x_from?: number;
  points?: { qubits: number; p_phys: number }[];
  formula_note?: string;
  sources: Source[];
}

export interface ChangelogEntry {
  dataset_version: string;
  /** Set by tools/release.py on merge day; a released version is frozen (rule 6). */
  released?: boolean;
  summary: string;
  added?: string[];
  updated?: string[];
  superseded?: string[];
  retracted?: string[];
}

/** A lab's line on the Landscape (data/lineages.yaml). */
export interface Lineage {
  id: string;
  label: string;
  short_label?: string;
  modality: Modality;
  vendors: string[];
  note?: string;
}

export interface Dataset {
  schema_version: number;
  dataset_version: string;
  vendors: Vendor[];
  devices: Device[];
  results: Result[];
  estimates: Estimate[];
  boundaries: Boundary[];
  lineages: Lineage[];
  changelog: ChangelogEntry[];
}
