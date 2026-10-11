// The only file that knows how the Landscape becomes a CompositeChart (brief
// §6). The host chart's x is time, so log10(qubits) rides in the timestamp,
// as options-positioning/model.ts does for strikes.
//
// y is log10(error) on a linear panel rather than error on a log panel: the
// host's log axis labels only its top, middle and bottom, while a linear axis
// puts round ticks on whole decades, which are then labelled as error rates.
//
// Domain, wider than the brief's sketch because the data needs it: x from 1
// to 1e8 qubits (Gidney–Ekerå's curve reaches 4e7), y from 1e-6 to 1e-1
// (the classically-simulable boundary and the Gidney–Ekerå sweep reach 1e-6).
import type { ResolvedSeries, TimeSeriesPoint } from "gloomberb/time-series";
import { fmtCount, fmtError, type ErrorFormat } from "../format";
import { targetRank } from "../model/estimates";
import type { LandscapeModel, LandscapePoint } from "../model/landscape";

export const X_MIN = 1;
export const X_MAX = 1e8;
const DECADES = Math.log10(X_MAX / X_MIN);
export const Y_DOMAIN: readonly [number, number] = [1e-6, 1e-1];
const SPAN = 1e12;

export const ratio = (x: number) => Math.min(1, Math.max(0, Math.log10(x / X_MIN) / DECADES));
export const xAtRatio = (r: number) => X_MIN * 10 ** (r * DECADES);

const TICK_LABELS = ["1", "10", "100", "1k", "10k", "100k", "1M", "10M", "100M"];
export const X_TICKS = TICK_LABELS.map((label, i) => ({ label, ratio: i / DECADES }));

export interface LandscapePalette {
  background: string;
  /** Single-pair and press-only points. */
  dim: string;
  /** Estimates that are not cryptanalytic (chemistry). */
  muted: string;
  boundary: string;
  /** One hue per technology; lineage lines take their technology's. */
  modality: Record<string, string>;
  rsa2048: string;
  ecc256: string;
}

interface XY {
  x: number;
  y: number;
  label: string;
  point?: LandscapePoint;
}

/** What sits at a cursor position: a result, an estimate's point, a boundary, or nothing. */
export type LandscapeTarget =
  | { kind: "result"; point: LandscapePoint }
  | { kind: "estimate"; estimateId: string; label: string; qubits: number; error: number; qubitsUpperBound: boolean }
  | { kind: "boundary"; label: string; qubits: number; error: number };

/**
 * A static series on the qubit axis, one point per value. Every mark gets
 * its own timestamp: marks that share an x (a vertical step on a curve, two
 * results at 105 qubits) are nudged 1 ms apart, invisible on a 1e12 span.
 * The chart keys points by time and would otherwise merge them, and the
 * cursor can then name exactly the mark it is on. The one exception is a
 * result: its marker and its vertex on a lineage line share one timestamp
 * (`resultTimes`), because the host's Left/Right steps through every distinct
 * timestamp on the chart and a result should take one press, not two.
 */
function series(
  id: string, label: string, color: string, style: ResolvedSeries["style"], xy: XY[],
  used: Set<number>, index: Map<number, LandscapeTarget> | null, target?: (i: number) => LandscapeTarget,
  resultTimes?: Map<string, number>,
): ResolvedSeries {
  const points: TimeSeriesPoint[] = xy.map((p, i) => {
    const resultId = p.point?.resultId;
    let t = resultId !== undefined ? resultTimes?.get(resultId) : undefined;
    if (t === undefined) {
      t = Math.round(ratio(p.x) * SPAN);
      while (used.has(t)) t += 1;
      used.add(t);
      if (resultId !== undefined) resultTimes?.set(resultId, t);
    }
    if (index && target) index.set(t, target(i));
    const date = new Date(t);
    return { date, observedAt: date, value: Math.log10(p.y), periodLabel: p.label };
  }).sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    id, label, color, unit: "", unitGroup: "", nativeFrequency: "daily", dataShape: "scalar", style,
    transform: "raw", axis: "right", panelId: "main", interpolation: "none", points,
  };
}

const byX = (a: XY, b: XY) => a.x - b.x || a.y - b.y;

function hardware(points: LandscapePoint[]): XY[] {
  return points.map((p) => ({ x: p.qubits, y: p.error, label: p.resultId, point: p })).sort(byX);
}

const MODALITY_ORDER = ["superconducting", "trapped_ion", "neutral_atom", "spin_semiconductor", "photonic", "topological", "other"];
/** A modality missing from MODALITY_ORDER sorts after every listed one. */
const modalityRank = (m: string) => {
  const i = MODALITY_ORDER.indexOf(m);
  return i === -1 ? MODALITY_ORDER.length : i;
};
/** Legend names for a target, given to its first estimate. */
const TARGET_LABELS: Record<string, string> = {
  rsa1024: "RSA-1024", rsa2048: "RSA-2048", rsa3072: "RSA-3072", rsa4096: "RSA-4096", ecc256: "ECC-256",
  femoco: "FeMoCo", other: "Other",
};
/** Targets the legend always names: the ones a security briefing is about. */
const CORE_TARGETS = new Set(["rsa2048", "ecc256"]);

/**
 * Cells a legend row needs for these entries, as the host lays it out: a
 * two-cell dot or a three-cell line sample, the label, one cell between
 * entries (components/chart/composite/legend.tsx).
 */
export function legendCells(entries: readonly ResolvedSeries[]): number {
  return entries.reduce((total, s, i) => total + (s.style === "points" ? 2 : 3) + s.label.length + (i > 0 ? 1 : 0), 0);
}

export interface LandscapeChart {
  series: ResolvedSeries[];
  /**
   * In cue order: the host gives line series solid, dashed, dotted, dash-dot
   * and heavy strokes in legend order, so the RSA-2048 curve comes first.
   */
  legendSeries: ResolvedSeries[];
  xAxis: { ticks: typeof X_TICKS; formatCursor: (r: number) => string };
  formatAxisValue: (value: number) => string;
  /** What the cursor is on, by its exact date; null for the pins or an empty spot. */
  lookup: (date: Date) => LandscapeTarget | null;
}

export function buildLandscapeChart(
  model: LandscapeModel,
  { palette, errorFormat, modalityLabels = {}, legendCells: room }: {
    palette: LandscapePalette;
    errorFormat: ErrorFormat;
    modalityLabels?: Record<string, string>;
    /** Cells the legend row has for series; entries beyond the essentials join only while they fit whole. */
    legendCells?: number;
  },
): LandscapeChart {
  const used = new Set<number>();
  const index = new Map<number, LandscapeTarget>();
  const resultTimes = new Map<string, number>();
  const resultSeries = (id: string, label: string, color: string, style: ResolvedSeries["style"], xy: XY[]) =>
    series(id, label, color, style, xy, used, index, (i) => ({ kind: "result", point: xy[i]!.point! }), resultTimes);

  // Legend groups, each entry marked essential or extra (with a priority).
  const estimates: { s: ResolvedSeries; core: boolean; target: string }[] = [];
  const boundaries: ResolvedSeries[] = [];
  const technologies: { s: ResolvedSeries; core: boolean }[] = [];
  const lineages: ResolvedSeries[] = [];

  const pin = series("pin", "", palette.background, "points", [
    { x: X_MIN, y: Y_DOMAIN[0], label: "pin:min" },
    { x: X_MAX, y: Y_DOMAIN[1], label: "pin:max" },
  ], used, null);

  for (const b of model.boundaries) {
    const xy = b.kind === "hline"
      ? [{ x: b.x_from ?? X_MIN, y: b.y!, label: `${b.id}:from` }, { x: X_MAX, y: b.y!, label: `${b.id}:to` }]
      : (b.points ?? []).map((p, i) => ({ x: p.qubits, y: p.p_phys, label: `${b.id}:${i}` }));
    boundaries.push(series(`boundary:${b.id}`, b.short_label ?? b.label, palette.boundary, "line", xy, used, index,
      (i) => ({ kind: "boundary", label: b.label, qubits: xy[i]!.x, error: xy[i]!.y })));
  }

  // Lines first, so every result's marker is drawn over them.
  for (const lineage of model.lineages) {
    lineages.push(resultSeries(`lineage:${lineage.id}`, lineage.shortLabel,
      palette.modality[lineage.modality] ?? palette.dim, "line", hardware(lineage.points)));
  }

  // Curves before points, then by target, so the first line cue goes to the RSA-2048 curve.
  const ordered = [...model.estimates].sort((a, b) =>
    (a.kind === "curve" ? 0 : 1) - (b.kind === "curve" ? 0 : 1)
    || targetRank(a.target) - targetRank(b.target));
  const named = new Set<string>();
  for (const e of ordered) {
    const color = e.target === "rsa2048" ? palette.rsa2048 : e.target === "ecc256" ? palette.ecc256 : palette.muted;
    const sorted = [...e.points].sort((a, b) => a.qubits - b.qubits || a.p_phys - b.p_phys);
    const xy = sorted.map((p) => ({ x: p.qubits, y: p.p_phys, label: `${e.id}@${p.p_phys}` }));
    // The first estimate of each target is named by its target; the rest by
    // their short label, with the code when it is not surface.
    const first = !named.has(e.target);
    named.add(e.target);
    const code = e.code_assumption === "qldpc" ? " (qLDPC)" : e.code_assumption === "other" ? " (other code)" : "";
    const label = first ? TARGET_LABELS[e.target] ?? e.target : `${e.short_label ?? e.label ?? e.id}${code}`;
    estimates.push({
      core: first && CORE_TARGETS.has(e.target),
      target: e.target,
      // Point estimates are never joined: only a tabulated curve is a line.
      s: series(`estimate:${e.id}`, label, color, e.kind === "curve" ? "line" : "points", xy, used, index, (i) => ({
        kind: "estimate", estimateId: e.id, label: e.label ?? e.id, qubits: sorted[i]!.qubits, error: sorted[i]!.p_phys,
        qubitsUpperBound: sorted[i]!.qubits_bound === "upper",
      })),
    });
  }
  // Grouped by target for the legend; within a target, curves stay first (stable sort).
  estimates.sort((a, b) => targetRank(a.target) - targetRank(b.target));

  const modalities = [...new Set(model.points.map((p) => p.modality))]
    .sort((a, b) => modalityRank(a) - modalityRank(b) || a.localeCompare(b));
  for (const m of modalities) {
    technologies.push({ core: true, s: resultSeries(`modality:${m}`, modalityLabels[m] ?? m, palette.modality[m] ?? palette.dim,
      "points", hardware(model.points.filter((p) => p.modality === m))) });
  }
  if (model.bestPairOnly.length) {
    technologies.push({ core: false, s: resultSeries("best-pair", "Single pair", palette.dim, "points", hardware(model.bestPairOnly)) });
  }
  if (model.pressOnly.length) {
    technologies.push({ core: false, s: resultSeries("press-only", "Press only", palette.dim, "points", hardware(model.pressOnly)) });
  }

  // Legend: essentials always; extras by priority while they fit: grey
  // points first (a grey dot is otherwise unexplained, while a secondary
  // RSA-2048 or ECC-256 estimate already wears its target's named colour),
  // then lineages (a line already wears its technology's colour), then other
  // estimates of the briefing targets, then other targets. At the default
  // floating width (120 cells) the lineages do not fit beside "Single pair".
  const legendOrder = [...estimates.map((e) => e.s), ...boundaries, ...technologies.map((t) => t.s), ...lineages];
  const shown = new Set<ResolvedSeries>([...estimates.filter((e) => e.core).map((e) => e.s), ...boundaries,
    ...technologies.filter((t) => t.core).map((t) => t.s)]);
  const extras = [
    ...technologies.filter((t) => !t.core).map((t) => t.s),
    ...lineages,
    ...estimates.filter((e) => !e.core && CORE_TARGETS.has(e.target)).map((e) => e.s),
    ...estimates.filter((e) => !e.core && !CORE_TARGETS.has(e.target)).map((e) => e.s),
  ];
  for (const extra of extras) {
    if (room === undefined) { shown.add(extra); continue; }
    const trial = legendOrder.filter((s) => shown.has(s) || s === extra);
    if (legendCells(trial) <= room) shown.add(extra);
  }

  return {
    // Draw order: boundaries, lineage lines, estimates, then results on top.
    series: [pin, ...boundaries, ...lineages, ...estimates.map((e) => e.s), ...technologies.map((t) => t.s)],
    legendSeries: legendOrder.filter((s) => shown.has(s)),
    xAxis: {
      ticks: X_TICKS,
      formatCursor: (r) => `${fmtCount(Number(xAtRatio(r).toPrecision(2)))} qubits`,
    },
    // Axis values are log10(error); padded edges (10^-0.7) round to two figures.
    formatAxisValue: (value) => fmtError(Number((10 ** value).toPrecision(2)), errorFormat),
    lookup: (date) => index.get(date.getTime()) ?? null,
  };
}
