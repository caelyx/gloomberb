// Values computed from a result, never stored (brief §3.3).
import { ISOLATED_2Q_METHODS } from "../data/enums.generated";
import type { Logical, Result, Value, WorstChannelName } from "../schema";

/**
 * True when the stored 2Q median was measured edge by edge in isolation (IBM: "batches with a
 * minimum separation of two qubits between edges"), so crosstalk is excluded. The value stays
 * stored and is shown with its method, but it is not like-for-like with a register-wide error
 * (data/README.md rule 18).
 */
export function isIsolated2q(result: Result): boolean {
  return result.err_2q_method !== undefined && (ISOLATED_2Q_METHODS as readonly string[]).includes(result.err_2q_method);
}

/** The register-wide 2Q error, for records, gaps and the Landscape: never an isolated-RB median. */
export function registerWide2q(result: Result): Value | undefined {
  return isIsolated2q(result) ? undefined : result.err_2q_register;
}

/** Two-qubit gates that fit in one T2 echo: comparable coherence across modalities. */
export function opsWithinT2(result: Result): number | null {
  const t2 = result.t2_echo?.v;
  const gate = result.gate_time_2q?.v;
  return t2 && gate ? t2 / gate : null;
}

export interface WorstChannel {
  value: number;
  name: WorstChannelName | null;
  /** True when computed here rather than stored by the curator. */
  derived: boolean;
}

// Register-wide raw channels only: best-pair and post-selected values would
// understate the worst channel.
const CHANNELS: Array<[WorstChannelName, (r: Result) => Value | undefined]> = [
  ["2q", (r) => r.err_2q_register],
  ["1q", (r) => r.err_1q],
  ["readout", (r) => r.err_readout],
  ["spam", (r) => r.err_spam],
  ["meas", (r) => r.err_midcircuit_meas],
];

/** Jaques's convention: the worst of the reported channels. Needs ≥2 when derived. */
export function worstChannel(result: Result): WorstChannel | null {
  if (result.err_worst_channel) {
    return { value: result.err_worst_channel.v, name: result.worst_channel_name ?? null, derived: false };
  }
  const present = CHANNELS
    .map(([name, read]) => [name, read(result)?.v] as const)
    .filter((entry): entry is readonly [WorstChannelName, number] => typeof entry[1] === "number");
  if (present.length < 2) return null;
  const [name, value] = present.reduce((worst, entry) => (entry[1] > worst[1] ? entry : worst));
  return { value, name, derived: true };
}

/** Logical qubits per block, `k` in [[n,k,d]]. */
export function codeK(codeParams: string): number | null {
  const match = /^\[\[\d+,(\d+),/.exec(codeParams);
  return match ? Number(match[1]) : null;
}

/**
 * Logical error per logical qubit per QEC cycle. Per-block values are divided
 * by k (a first-order normalisation, flagged). Per-gate and per-circuit
 * errors are not per-cycle and return null.
 */
export function perLogicalQubitCycleError(entry: Logical): { value: number; normalised: boolean } | null {
  const v = entry.logical_error?.v;
  if (v === undefined) return null;
  switch (entry.logical_error_basis) {
    case "per_cycle_single_lq":
    case "per_lq_per_cycle":
      return { value: v, normalised: false };
    case "per_block_per_round": {
      const k = codeK(entry.code_params);
      return k ? { value: v / k, normalised: k !== 1 } : null;
    }
    default:
      return null;
  }
}
