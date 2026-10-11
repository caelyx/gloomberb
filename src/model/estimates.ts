// CRQC resource estimates and the gap from a device to each (brief §7, as
// amended). Gaps are per estimate and grouped by target and code assumption;
// they are never merged into a single "nearest" figure, because a lower qubit
// count under a different code usually moves the difficulty (connectivity,
// decoding, runtime) rather than removing it.
import type { CodeAssumption, Estimate, EstimatePoint, EstimateTarget, Result } from "../schema";
import { registerWide2q } from "./derived";

export type QubitsBasis = "tabulated" | "interpolated" | "upper_bound";

/** How a count on this basis reads: "≤" a bound, "≈" an interpolation, nothing when tabulated. */
export function qubitsBasisPrefix(basis: QubitsBasis | null | undefined): "" | "≤" | "≈" {
  return basis === "upper_bound" ? "≤" : basis === "interpolated" ? "≈" : "";
}

/** Targets in briefing order: RSA-2048 and ECC-256 first, then the others. */
export const TARGET_ORDER: readonly string[] = ["rsa2048", "ecc256", "rsa1024", "rsa3072", "rsa4096", "femoco", "other"];

/** A target's place in TARGET_ORDER; one missing from it sorts after every listed target. */
export function targetRank(target: string): number {
  const i = TARGET_ORDER.indexOf(target);
  return i === -1 ? TARGET_ORDER.length : i;
}

/**
 * Physical qubits the estimate needs at physical error `p`. A curve is linear
 * in (log10 p, log10 qubits) between tabulated points; a point estimate's
 * stated points are never joined, so between them the count at the next worse
 * error is an upper bound. No extrapolation: at a better error than any
 * stated point the best count is an upper bound; at a worse error than any,
 * the estimate does not apply (null).
 */
export function qubitsAt(estimate: Estimate, p: number): { qubits: number; basis: QubitsBasis } | null {
  if (!Number.isFinite(p)) return null;
  // A point with no positive count or error says nothing (and has no logarithm).
  const points = estimate.points
    .filter((pt) => Number.isFinite(pt.p_phys) && pt.p_phys > 0 && Number.isFinite(pt.qubits) && pt.qubits > 0)
    .sort((a, b) => a.p_phys - b.p_phys);
  const lowest = points[0];
  const highest = points[points.length - 1];
  if (!lowest || !highest) return null;
  if (p > highest.p_phys) return null;
  if (p < lowest.p_phys) return { qubits: lowest.qubits, basis: "upper_bound" };
  const exact = points.find((pt) => pt.p_phys === p);
  if (exact) return { qubits: exact.qubits, basis: exact.qubits_bound === "upper" ? "upper_bound" : "tabulated" };
  if (estimate.kind === "point") {
    const nextWorse = points.find((pt) => pt.p_phys > p)!;
    return { qubits: nextWorse.qubits, basis: "upper_bound" };
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (p > a.p_phys && p < b.p_phys) {
      // A stated bound at either end bounds the whole segment: only the
      // worse-error count is then sure to be enough.
      if (a.qubits_bound === "upper" || b.qubits_bound === "upper") return { qubits: b.qubits, basis: "upper_bound" };
      const t = (Math.log10(p) - Math.log10(a.p_phys)) / (Math.log10(b.p_phys) - Math.log10(a.p_phys));
      const log = Math.log10(a.qubits) + t * (Math.log10(b.qubits) - Math.log10(a.qubits));
      return { qubits: 10 ** log, basis: "interpolated" };
    }
  }
  return null;
}

/** Physical qubits × runtime (qubit·seconds), when the estimate states a runtime. */
export function spacetimeVolume(point: EstimatePoint): number | null {
  return point.runtime_s === undefined ? null : point.qubits * point.runtime_s;
}

export interface Gap {
  resultId: string;
  estimateId: string;
  target: EstimateTarget;
  codeAssumption: CodeAssumption;
  deviceError: number;
  deviceQubits: number;
  /** Device register-wide 2Q error ÷ the worst error the estimate covers; ≤ 1 means it already meets it. */
  errorGap: number;
  /** Null when the device's error is worse than the estimate covers: no qubit count applies yet. */
  qubitsNeeded: number | null;
  qubitsBasis: QubitsBasis | null;
  qubitGap: number | null;
}

export function gapToEstimate(result: Result, estimate: Estimate): Gap | null {
  // An isolated-RB median is not register-wide (data/README.md rule 18): no gap.
  const error = registerWide2q(result)?.v;
  const qubits = result.qubits_programmable;
  if (error === undefined || qubits === undefined || !(qubits > 0)) return null;
  const covered = estimate.points.map((p) => p.p_phys).filter((p) => Number.isFinite(p) && p > 0);
  if (covered.length === 0) return null;
  const worstCovered = Math.max(...covered);
  const needed = qubitsAt(estimate, error);
  return {
    resultId: result.id,
    estimateId: estimate.id,
    target: estimate.target,
    codeAssumption: estimate.code_assumption,
    deviceError: error,
    deviceQubits: qubits,
    errorGap: error / worstCovered,
    qubitsNeeded: needed?.qubits ?? null,
    qubitsBasis: needed?.basis ?? null,
    qubitGap: needed ? needed.qubits / qubits : null,
  };
}

/** Every result × estimate gap, ordered by target (TARGET_ORDER), then code assumption, then estimate. */
export function gapTable(results: Result[], estimates: Estimate[]): Gap[] {
  const rows: Gap[] = [];
  for (const result of results) {
    for (const estimate of estimates) {
      const gap = gapToEstimate(result, estimate);
      if (gap) rows.push(gap);
    }
  }
  return rows.sort((a, b) =>
    targetRank(a.target) - targetRank(b.target)
    || a.target.localeCompare(b.target)
    || a.codeAssumption.localeCompare(b.codeAssumption)
    || a.estimateId.localeCompare(b.estimateId)
    || a.resultId.localeCompare(b.resultId));
}
