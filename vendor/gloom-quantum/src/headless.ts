// Headless reports (`gloomberb fn QC|QCR|QCD|QCE`). JSON carries raw SI values;
// text output formats them through format.ts with the chosen error format.
import type {
  HeadlessBundleSection,
  HeadlessPaneColumn,
  HeadlessPaneDefinition,
  HeadlessPaneFreshness,
  HeadlessPaneLoadArgs,
  HeadlessPaneOptionDef,
  HeadlessPaneRow,
} from "gloomberb/types/plugin";
import { DATASET } from "./data/generated";
import { ERROR_FORMATS, fmtCount, fmtError, fmtRatio, fmtRuntime, fmtTime, type ErrorFormat } from "./format";
import { PLUGIN_ID } from "./ids";
import { qubitsBasisPrefix, type QubitsBasis } from "./model/estimates";
import { buildLandscape, type LandscapePoint } from "./model/landscape";
import { effectiveToday, LOOKBACK_VALUES, localToday, parseLookback, type LookbackYears } from "./model/lookback";
import { MODALITY_LABELS, type MetricUnit } from "./model/registry";
import { deviceRows, estimateRows, gapRows, recordRows } from "./model/report";
import type { Dataset } from "./schema";

export function lookbackOption(defaultValue: LookbackYears): HeadlessPaneOptionDef {
  return {
    key: "lookbackYears",
    aliases: ["lookback-years"],
    description: "Only results first published within this many years (1, 2, 5 or all).",
    type: "enum",
    values: LOOKBACK_VALUES.map((value) => ({ value })),
    defaultValue,
    pluginState: { pluginId: PLUGIN_ID, key: "lookbackYears" },
  };
}

const ERROR_FORMAT_OPTION: HeadlessPaneOptionDef = {
  key: "errorFormat",
  aliases: ["error-format"],
  description: "How error rates print as text: auto, percent, exponent or fidelity. JSON values stay raw fractions.",
  type: "enum",
  values: ERROR_FORMATS.map((value) => ({ value })),
  defaultValue: "auto",
  pluginState: { pluginId: PLUGIN_ID, key: "errorFormat" },
};

export function datasetFreshness(dataset: Dataset): HeadlessPaneFreshness {
  return {
    source: "Published papers and vendor data sheets",
    status: "not-a-feed",
    basis: `curated dataset ${dataset.dataset_version}`,
  };
}

interface Selection {
  lookback: LookbackYears;
  today: string;
  errorFormat: ErrorFormat;
}

/** The local day, as `YYYY-MM-DD`; injectable so tests can fix the clock. */
type Today = () => string;

function selectionFor(args: HeadlessPaneLoadArgs, fallback: LookbackYears, dataset: Dataset, today: Today): Selection {
  const format = String(args.options.errorFormat ?? "auto");
  return {
    lookback: parseLookback(String(args.options.lookbackYears ?? fallback), fallback),
    // Never before the dataset's own date: rows carry the curator's (Sydney) date.
    today: effectiveToday(dataset.dataset_version, today()),
    errorFormat: (ERROR_FORMATS as readonly string[]).includes(format) ? (format as ErrorFormat) : "auto",
  };
}

const text = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const times = (value: unknown) => fmtRatio(typeof value === "number" ? value : null);

function formatValue(unit: MetricUnit, value: unknown, errorFormat: ErrorFormat): string {
  if (typeof value !== "number") return "—";
  switch (unit) {
    case "count": return fmtCount(value);
    case "error": return fmtError(value, errorFormat);
    case "time": return fmtTime(value);
    case "ratio": return value >= 100 ? fmtCount(value) : String(Number(value.toPrecision(3)));
    case "distance": return `d=${value}`;
  }
}

const FLAG_LABELS: Record<string, string> = {
  press_only: "press only",
  t2_dd_fallback: "dynamical decoupling, not echo",
  extrapolated: "extrapolated",
  normalised_by_k: "per-block error ÷ k",
};

/** A 2Q error that is not register-wide keeps its mark: `*` single pair, `iso` an isolated-RB median. */
const ERR2Q_MARK: Record<string, string> = { best_pair: " *", isolated: " iso" };

/** A non-gate count's unit as printed. */
const OTHER_UNIT: Record<string, string> = { analog: "analogue" };

const readable = (value: unknown) => (typeof value === "string" ? value.replaceAll("_", " ") : "—");

const EVIDENCE_GLYPH: Record<string, string> = { verified_primary: "✓", press_only: "~" };

// --- QCR -------------------------------------------------------------------

function recordColumns(errorFormat: ErrorFormat): HeadlessPaneColumn[] {
  return [
    { key: "label", header: "Record" },
    { key: "group", header: "Group", format: readable },
    { key: "value", header: "Value", align: "right",
      format: (value, row) => formatValue(row.unit as MetricUnit, value, errorFormat) },
    { key: "vendor", header: "Vendor", format: text },
    { key: "device", header: "Device", format: text },
    { key: "date", header: "Date", format: text },
    { key: "flags", header: "Notes",
      format: (value, row) => [
        ...(Array.isArray(value) ? value.map((f) => FLAG_LABELS[f] ?? f) : []),
        typeof row.context === "string" ? row.context : null,
      ].filter(Boolean).join("; ") },
    { key: "claimedValue", header: "Claimed (press only)", align: "right",
      format: (value, row) => formatValue(row.unit as MetricUnit, value, errorFormat) },
  ];
}

export function createRecordsHeadless(dataset: Dataset = DATASET, today: Today = localToday): HeadlessPaneDefinition<"rows"> {
  return {
    shape: "rows",
    description: "The current best verified result on each quantum hardware metric, with any larger press-only claim beside it.",
    argument: { kind: "none", optional: true },
    options: [lookbackOption("all"), ERROR_FORMAT_OPTION],
    freshness: datasetFreshness(dataset),
    columns: recordColumns("auto"),
    describe: "Quantum Records",
    load(args) {
      const s = selectionFor(args, "all", dataset, today);
      return {
        columns: recordColumns(s.errorFormat),
        rows: recordRows(dataset, s) as unknown as HeadlessPaneRow[],
        metadata: { datasetVersion: dataset.dataset_version, lookbackYears: s.lookback },
      };
    },
  };
}

// --- QCD -------------------------------------------------------------------

function deviceColumns(errorFormat: ErrorFormat): HeadlessPaneColumn[] {
  return [
    { key: "date", header: "Date" },
    { key: "vendor", header: "Vendor" },
    { key: "device", header: "Device" },
    // An annealer is listed apart: it cannot run Shor's algorithm (data/README.md rule 20).
    { key: "modality", header: "Modality", format: (v, row) => (row.inScope === false ? "Annealing (out of scope)" : readable(v)) },
    { key: "qubits", header: "Qubits", align: "right", format: (v, row) => {
      if (typeof v === "number") return fmtCount(v);
      const other = row.otherCount as { value: number; unit: string } | null;
      return other ? `${fmtCount(other.value)} ${OTHER_UNIT[other.unit] ?? other.unit}` : "—";
    } },
    { key: "err2q", header: errorFormat === "fidelity" ? "2Q fidelity" : "2Q error", align: "right",
      format: (v, row) => `${fmtError(v as number | null, errorFormat)}${ERR2Q_MARK[String(row.err2qBasis)] ?? ""}` },
    { key: "logicalCorrected", header: "Logical corr/det", align: "right",
      format: (v, row) => `${text(v)}/${text(row.logicalDetected)}` },
    { key: "lambda", header: "Λ", align: "right", format: text },
    { key: "codes", header: "Codes", format: text },
    { key: "evidence", header: "Ev", format: (v, row) => (row.status === "disputed" ? "!" : EVIDENCE_GLYPH[String(v)] ?? "") },
  ];
}

export function createDevicesHeadless(dataset: Dataset = DATASET, today: Today = localToday): HeadlessPaneDefinition<"rows"> {
  return {
    shape: "rows",
    description: "Every quantum hardware result in the lookback window, newest first. Annealers are listed as out of scope (inScope false): they cannot run Shor's algorithm. '*' marks a single-pair 2Q error, 'iso' a median measured edge by edge in isolation (crosstalk excluded); ✓ primary source, ~ press only, ! disputed.",
    argument: { kind: "none", optional: true },
    options: [lookbackOption("5"), ERROR_FORMAT_OPTION],
    freshness: datasetFreshness(dataset),
    columns: deviceColumns("auto"),
    describe: "Quantum Devices",
    load(args) {
      const s = selectionFor(args, "5", dataset, today);
      return {
        columns: deviceColumns(s.errorFormat),
        rows: deviceRows(dataset, s) as unknown as HeadlessPaneRow[],
        metadata: { datasetVersion: dataset.dataset_version, lookbackYears: s.lookback },
      };
    },
  };
}

// --- QCE -------------------------------------------------------------------

const bounded = (key: string, row: HeadlessPaneRow, text: string) =>
  (Array.isArray(row.upperBounds) && row.upperBounds.includes(key) && text !== "—" ? `≤${text}` : text);
const qubitsText = (key: string) => (v: unknown, row: HeadlessPaneRow) =>
  bounded(key, row, typeof v === "number" ? fmtCount(v) : "—");

function gapColumns(errorFormat: ErrorFormat): HeadlessPaneColumn[] {
  return [
    { key: "target", header: "Target" },
    { key: "codeAssumption", header: "Code", format: readable },
    { key: "estimate", header: "Estimate" },
    { key: "device", header: "Device" },
    { key: "deviceError", header: "Device 2Q", align: "right", format: (v) => fmtError(v as number, errorFormat) },
    { key: "errorGap", header: "Error gap", align: "right", format: times },
    { key: "qubitsNeeded", header: "Qubits needed", align: "right",
      format: (v, row) => {
        if (typeof v !== "number") return "n/a";
        const basis = row.qubitsBasis as QubitsBasis | null;
        return `${qubitsBasisPrefix(basis)}${fmtCount(basis === "interpolated" ? Number(v.toPrecision(2)) : v)}`;
      } },
    // A gap computed from a bounded or interpolated count is bounded or approximate too.
    { key: "qubitGap", header: "Qubit gap", align: "right",
      format: (v, row) => (typeof v === "number" ? `${qubitsBasisPrefix(row.qubitsBasis as QubitsBasis | null)}${times(v)}` : times(v)) },
  ];
}

export function createEstimatesHeadless(dataset: Dataset = DATASET, today: Today = localToday): HeadlessPaneDefinition<"bundle"> {
  return {
    shape: "bundle",
    description: "Published CRQC resource estimates, and each record-holding device's gap to each one, grouped by target and code assumption (never merged).",
    argument: { kind: "none", optional: true },
    options: [
      lookbackOption("all"),
      ERROR_FORMAT_OPTION,
      // No default: unset, the report shows both sections and the pane opens on Estimates.
      { key: "view", description: "Show only the Estimates or the Gaps section (in a screenshot, the pane's tab).",
        type: "enum", values: [{ value: "estimates" }, { value: "gaps" }],
        pluginState: { pluginId: PLUGIN_ID, key: "tab" } },
    ],
    freshness: datasetFreshness(dataset),
    describe: "Quantum Estimates",
    load(args) {
      const s = selectionFor(args, "all", dataset, today);
      const view = args.options.view;
      const sections: HeadlessBundleSection[] = [
          {
            title: "Estimates (physical qubits as stated)",
            columns: [
              { key: "label", header: "Estimate" },
              { key: "target", header: "Target" },
              { key: "codeAssumption", header: "Code" },
              { key: "connectivity", header: "Connectivity", format: readable },
              { key: "qubitsAt1e3", header: "Qubits @1e-3", align: "right", format: qubitsText("qubitsAt1e3") },
              { key: "qubitsAt1e4", header: "Qubits @1e-4", align: "right", format: qubitsText("qubitsAt1e4") },
              { key: "runtimeAt1e3", header: "Runtime @1e-3", align: "right",
                format: (v, row) => bounded("runtimeAt1e3", row, fmtRuntime(typeof v === "number" ? v : null)) },
              { key: "date", header: "Date" },
            ],
            rows: estimateRows(dataset) as unknown as HeadlessPaneRow[],
          },
          {
            title: "Gap from record-holding devices",
            columns: gapColumns(s.errorFormat),
            rows: gapRows(dataset, s) as unknown as HeadlessPaneRow[],
          },
        ];
      return {
        sections: view === "estimates" ? [sections[0]!] : view === "gaps" ? [sections[1]!] : sections,
        notes: [
          "Error gap = device register-wide 2Q error ÷ the worst error the estimate covers; ≤ ×1 already meets it.",
          "Qubit gap is n/a when the device's error is worse than the estimate covers. '≤' marks an upper bound, '≈' an interpolation on a curve.",
          "Each device is represented by its result with the lowest register-wide 2Q error.",
        ],
        metadata: { datasetVersion: dataset.dataset_version, lookbackYears: s.lookback },
      };
    },
  };
}

// --- QC --------------------------------------------------------------------

function seriesPoints(points: LandscapePoint[], errorFormat: ErrorFormat) {
  return points.map((p) => ({
    date: p.date,
    value: p.error,
    /** `value` as text in the chosen error format; `value` itself stays the raw fraction. */
    error: fmtError(p.error, errorFormat),
    qubits: p.qubits,
    device: p.deviceName,
    result: p.resultId,
    errorKind: p.errorKind,
  }));
}

export function createLandscapeHeadless(dataset: Dataset = DATASET, today: Today = localToday): HeadlessPaneDefinition<"series"> {
  return {
    shape: "series",
    description: "Quantum hardware results as programmable physical qubits (field `qubits`) against error rate (`value`, a raw fraction; `error` is the same in the chosen error format), one series per modality, plus single-pair and press-only series. Statistics give each series' lowest error.",
    argument: { kind: "none", optional: true },
    options: [
      lookbackOption("all"),
      ERROR_FORMAT_OPTION,
      {
        key: "yMetric",
        aliases: ["y-metric"],
        description: "Y axis: err_2q_register (default) or err_worst_channel (Jaques convention).",
        type: "enum",
        values: [{ value: "err_2q_register" }, { value: "err_worst_channel" }],
        defaultValue: "err_2q_register",
        settingKey: "yMetric",
      },
      { key: "showPressOnly", aliases: ["show-press-only"], description: "Include press-only results.",
        type: "boolean", defaultValue: false, settingKey: "showPressOnly" },
      { key: "showBestPairOnly", aliases: ["show-best-pair-only"], description: "Include results that report only a single-pair 2Q error.",
        type: "boolean", defaultValue: true, settingKey: "showBestPairOnly" },
    ],
    freshness: datasetFreshness(dataset),
    describe: "Quantum Landscape",
    load(args) {
      const s = selectionFor(args, "all", dataset, today);
      const model = buildLandscape(dataset, {
        yMetric: args.options.yMetric === "err_worst_channel" ? "err_worst_channel" : "err_2q_register",
        lookback: s.lookback,
        today: s.today,
        showBestPairOnly: args.options.showBestPairOnly !== false,
        showPressOnly: args.options.showPressOnly === true,
      });
      const modalities = [...new Set(model.points.map((p) => p.modality))];
      const groups = [
        ...modalities.map((m) => ({ id: m, label: MODALITY_LABELS[m] ?? readable(m), points: model.points.filter((p) => p.modality === m) })),
        { id: "best_pair_only", label: "Single pair only", points: model.bestPairOnly },
        { id: "press_only", label: "Press only", points: model.pressOnly },
      ].filter((group) => group.points.length > 0);
      const series = groups.map((g) => ({
        id: g.id, label: g.label, unit: "error fraction", points: seriesPoints(g.points, s.errorFormat),
      }));
      // The text report prints each series' latest point only, so the lowest error, the
      // figure a reader wants, is a statistic, shown in the chosen error format.
      const stats = groups.map((g) => {
        const lowest = Math.min(...g.points.map((p) => p.error));
        return { key: `${g.id}.lowestError`, label: `${g.label}: lowest error`, value: lowest, formatted: fmtError(lowest, s.errorFormat) };
      });
      return {
        series,
        stats,
        metadata: { datasetVersion: dataset.dataset_version, lookbackYears: s.lookback, omitted: model.omitted },
      };
    },
  };
}

export const landscapeHeadless = createLandscapeHeadless();
export const recordsHeadless = createRecordsHeadless();
export const devicesHeadless = createDevicesHeadless();
export const estimatesHeadless = createEstimatesHeadless();
