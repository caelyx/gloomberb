// `gloomberb quantum records|devices|estimates`: the fn QCR/QCD/QCE reports as a
// plugin command (brief Phase 8). Each subcommand loads the same headless
// definition `fn` does, so the two always give the same rows; this file only
// parses the options and hands the result to the host's `ctx.printResult`.
// Text formats through the headless columns (fmtError etc., as the panes do);
// JSON and CSV keep raw SI values, CSV with a note naming the units.
import type {
  CliCommandContext,
  CliCommandDef,
  HeadlessBundleSection,
  HeadlessPaneColumn,
  HeadlessPaneDefinition,
  HeadlessPaneRow,
} from "gloomberb/types/plugin";
import { DATASET } from "./data/generated";
import { ERROR_FORMATS, type ErrorFormat } from "./format";
import { createDevicesHeadless, createEstimatesHeadless, createRecordsHeadless, datasetFreshness } from "./headless";
import { LOOKBACK_VALUES, localToday, versionDate, type LookbackYears } from "./model/lookback";
import type { Dataset } from "./schema";

export const QUANTUM_SUBCOMMANDS = ["records", "devices", "estimates"] as const;
export type QuantumSubcommand = (typeof QUANTUM_SUBCOMMANDS)[number];

const VIEWS = ["estimates", "gaps"] as const;
type EstimatesView = (typeof VIEWS)[number];

export interface QuantumCliOptions {
  lookbackYears?: LookbackYears;
  errorFormat?: ErrorFormat;
  view?: EstimatesView;
}

/** A usage error, with the line the host prints under it. */
export class QuantumCliError extends Error {
  constructor(message: string, readonly details?: string) {
    super(message);
  }
}

/** "1, 2, 5 or all" */
const either = (values: readonly string[]) => `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;

interface FlagSpec {
  /** The option key the headless definition reads. */
  key: keyof QuantumCliOptions;
  values: readonly string[];
  /** Subcommands that take it; every one when absent. */
  only?: QuantumSubcommand;
}

const FLAGS: Record<string, FlagSpec> = {
  "--lookback": { key: "lookbackYears", values: LOOKBACK_VALUES },
  "--error-format": { key: "errorFormat", values: ERROR_FORMATS },
  "--view": { key: "view", values: VIEWS, only: "estimates" },
};
// `fn` spells it --lookback-years (brief §5); the command takes either.
const FLAG_ALIASES: Record<string, string> = { "--lookback-years": "--lookback" };

const USAGE = "Usage: gloomberb quantum records|devices|estimates [options]";

export type ParsedQuantumArgs = { subcommand: QuantumSubcommand; options: QuantumCliOptions } | { help: true };

/** `-h`/`--help` anywhere. The host takes them before `--`; they reach the command only after it. */
const isHelpFlag = (arg: string) => arg === "-h" || arg === "--help";

/**
 * The subcommand and options, `{ help: true }` for -h/--help, or a QuantumCliError saying what is wrong.
 * `--json`/`--csv` are the host's, already removed. A flag given twice is an error, not "last one wins".
 */
export function parseQuantumArgs(args: readonly string[]): ParsedQuantumArgs {
  if (args.some(isHelpFlag)) return { help: true };
  const [first, ...rest] = args;
  if (first === undefined) throw new QuantumCliError(USAGE);
  if (!(QUANTUM_SUBCOMMANDS as readonly string[]).includes(first)) {
    throw new QuantumCliError(`Unknown quantum command "${first}". Use ${either(QUANTUM_SUBCOMMANDS)}.`);
  }
  const subcommand = first as QuantumSubcommand;
  const flagsFor = Object.keys(FLAGS).filter((flag) => !FLAGS[flag]!.only || FLAGS[flag]!.only === subcommand);
  const options: QuantumCliOptions = {};
  const given = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!arg.startsWith("--")) throw new QuantumCliError(`Unexpected argument "${arg}" for quantum ${subcommand}.`);
    const equals = arg.indexOf("=");
    const written = equals >= 0 ? arg.slice(0, equals) : arg;
    const flag = FLAG_ALIASES[written] ?? written;
    const spec = FLAGS[flag];
    if (!spec) {
      throw new QuantumCliError(
        `Unknown option ${written} for quantum ${subcommand}.`,
        `Options: ${flagsFor.join(", ")}. See gloomberb help quantum.`,
      );
    }
    if (spec.only && spec.only !== subcommand) throw new QuantumCliError(`${flag} applies to quantum ${spec.only} only.`);
    if (given.has(flag)) {
      throw new QuantumCliError(`${written} given more than once${written === flag ? "" : ` (it is ${flag})`}.`);
    }
    given.set(flag, written);
    const value = equals >= 0 ? arg.slice(equals + 1) : rest[++index];
    if (value === undefined || value === "") throw new QuantumCliError(`${flag} needs a value: ${either(spec.values)}.`);
    if (!spec.values.includes(value)) throw new QuantumCliError(`${flag} must be ${either(spec.values)}, not "${value}".`);
    (options as Record<string, string>)[spec.key] = value;
  }
  return { subcommand, options };
}

// --- CSV -------------------------------------------------------------------

/** What CSV's raw numbers are: the first `#` line under the table (as tableExport's notes are). */
const UNITS_NOTE: Record<QuantumSubcommand, string> = {
  records: "Units: value and claimedValue are raw SI values in the row's unit: error as a fraction (0.00079, not 0.079 %), time in seconds; count, ratio and distance as plain numbers.",
  devices: "Units: err2q is a raw fraction (0.00079, not 0.079 %) whatever --error-format says; err2qBasis says whether it is register-wide, a single pair (best_pair) or an isolated-RB median (isolated). Counts are plain numbers.",
  estimates: "Units: qubitsAt1e3 and qubitsAt1e4 are physical qubits, runtimeAt1e3 is in seconds, spacetimeAt1e3 in qubit-seconds; upperBounds names the figures stated as upper bounds. deviceError is a raw fraction; errorGap and qubitGap are plain ratios; qubitsBasis says whether qubitsNeeded is tabulated, an upper bound or interpolated.",
};

type CsvValue = string | number;

function csvCell(value: unknown): CsvValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join("; ");
  return String(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Every field of every row, raw; a nested object (a device's `otherCount`) becomes `otherCount.value`, `otherCount.unit`. */
export function csvTable(title: string, rows: readonly HeadlessPaneRow[]) {
  // Which fields are ever an object, so a row whose object is null still gets the flattened columns.
  const nested = new Map<string, string[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!isRecord(value)) continue;
      const inner = nested.get(key) ?? [];
      for (const k of Object.keys(value)) if (!inner.includes(k)) inner.push(k);
      nested.set(key, inner);
    }
  }
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      for (const column of nested.has(key) ? nested.get(key)!.map((k) => `${key}.${k}`) : [key]) {
        if (!columns.includes(column)) columns.push(column);
      }
    }
  }
  const read = (row: HeadlessPaneRow, column: string) => {
    const [key, inner] = column.split(".", 2) as [string, string | undefined];
    const value = row[key];
    if (inner === undefined) return value;
    return isRecord(value) ? value[inner] : null;
  };
  return { title, columns, rows: rows.map((row) => columns.map((column) => csvCell(read(row, column)))) };
}

// --- Command ---------------------------------------------------------------

const DESCRIPTION: Record<QuantumSubcommand, string> = {
  records: "Current best result on each quantum hardware metric (fn QCR)",
  devices: "Quantum hardware results in the lookback window, newest first (fn QCD)",
  estimates: "CRQC resource estimates and each device's gap to them (fn QCE)",
};

const LEGEND = "* single pair · iso isolated-RB median · ✓ primary source · ~ press only · ! disputed";

type Freshness = NonNullable<Parameters<CliCommandContext["printResult"]>[0]["freshness"]>;

function lookbackText(years: unknown): string {
  return years === "all" ? "lookback: all years" : `lookback: last ${String(years)} ${years === "1" ? "year" : "years"}`;
}

function sectionKey(index: number, view: EstimatesView | undefined): EstimatesView {
  return view ?? VIEWS[index]!;
}

/** The command's help as plain text, from the same `help` the host's `gloomberb help quantum` shows. */
export function helpText(def: Pick<CliCommandDef, "name" | "description" | "help">): string {
  const help = def.help ?? {};
  const lines = [def.description, "", "Usage:", ...(help.usage ?? []).map((u) => `  gloomberb ${u}`)];
  for (const section of help.sections ?? []) {
    lines.push("", `${section.title}:`, ...(section.rows ?? []).map((row) => `  ${row.join("  ")}`), ...(section.lines ?? []).map((l) => `  ${l}`));
  }
  if (help.options?.length) {
    const width = Math.max(...help.options.map((o) => o.flags.length));
    lines.push("", "Options:", ...help.options.map((o) => `  ${o.flags.padEnd(width)}  ${o.description}`));
  }
  if (help.examples?.length) lines.push("", "Examples:", ...help.examples.map((e) => `  gloomberb ${e}`));
  return lines.join("\n");
}

function cellText(column: HeadlessPaneColumn, row: HeadlessPaneRow): string {
  const value = row[column.key];
  if (column.format) return column.format(value, row);
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function createQuantumCliCommand(dataset: Dataset = DATASET, today: () => string = localToday): CliCommandDef {
  const headless: Record<QuantumSubcommand, HeadlessPaneDefinition> = {
    records: createRecordsHeadless(dataset, today),
    devices: createDevicesHeadless(dataset, today),
    estimates: createEstimatesHeadless(dataset, today),
  };
  const source = datasetFreshness(dataset);
  const optionLine = "[--lookback <years>] [--error-format <format>]";

  const command: CliCommandDef = {
    name: "quantum",
    description: "Quantum hardware records, devices and CRQC estimates from the curated dataset",
    help: {
      usage: [
        `quantum records ${optionLine}`,
        `quantum devices ${optionLine}`,
        `quantum estimates ${optionLine} [--view estimates|gaps]`,
      ],
      options: [
        { flags: "--lookback <years>", description: "Results first published within this many years (also --lookback-years). Defaults: devices 5, records and estimates all." },
        { flags: "--error-format <format>", description: "auto, percent, exponent or fidelity: how error rates print as text. JSON and CSV stay raw fractions." },
        { flags: "--view <estimates|gaps>", description: "estimates only: just the Estimates or the Gaps table; both when unset." },
      ],
      examples: [
        "quantum records",
        "quantum devices --lookback 2 --error-format exponent",
        "quantum estimates --view gaps --json",
        "quantum records --csv > records.csv",
      ],
      sections: [{
        title: "Subcommands",
        columns: [{ header: "Command" }, { header: "Shows" }],
        rows: QUANTUM_SUBCOMMANDS.map((sub) => [`quantum ${sub}`, DESCRIPTION[sub]]),
      }],
    },
    async execute(args, ctx) {
      let parsed: ReturnType<typeof parseQuantumArgs>;
      try {
        parsed = parseQuantumArgs(args);
      } catch (error) {
        if (error instanceof QuantumCliError) ctx.fail(error.message, error.details);
        throw error;
      }
      if ("help" in parsed) {
        const text = helpText(command);
        ctx.printResult({ data: { command: command.name, usage: command.help?.usage ?? [], text } }, { text: () => text });
        return;
      }
      const { subcommand, options } = parsed;
      const freshness: Freshness = {
        source: source.source!,
        asOf: versionDate(dataset.dataset_version),
        status: "not-a-feed",
        basis: source.basis,
        retrievedAt: new Date().toISOString(),
      };
      const loadArgs = { rawArgument: "", argument: null, symbols: [], options: { ...options } };
      // These loads read only the bundled dataset; they never touch the host context.
      const loaded = await headless[subcommand].load(loadArgs, undefined as never);
      const tabular = ctx.cliOptions.format === "csv" || ctx.cliOptions.format === "ndjson";
      const metadata = { ...loaded.metadata, ...(loaded.notes?.length ? { notes: loaded.notes } : {}) };
      const footer = (titles: string) => [
        UNITS_NOTE[subcommand],
        `source: ${freshness.source}; dataset ${dataset.dataset_version}; ${lookbackText(loaded.metadata?.lookbackYears)}; ${titles}`,
      ];

      if ("rows" in loaded) {
        const rows = loaded.rows;
        ctx.printResult({ data: rows, metadata, freshness }, {
          columns: loaded.columns ?? [],
          layout: "table",
          empty: "No results in this lookback window.",
          ...(subcommand === "devices" ? { summary: () => ctx.output.cliStyles.muted(LEGEND) } : {}),
          ...(tabular ? { tables: { tables: [csvTable(subcommand, rows)], footer: footer(subcommand) } } : {}),
        });
        return;
      }

      if ("sections" in loaded) {
        const sections = loaded.sections.filter((s): s is Extract<HeadlessBundleSection, { rows: HeadlessPaneRow[] }> => Array.isArray(s.rows));
        const data = Object.fromEntries(sections.map((s, i) => [sectionKey(i, options.view), s.rows]));
        const text = () => [
          ...sections.map((s) => {
            const columns = s.columns ?? [];
            const table = s.rows.length === 0
              ? ctx.output.cliStyles.muted("No rows.")
              : ctx.output.renderTable(columns.map((c) => ({ header: c.header, align: c.align })), s.rows.map((row) => columns.map((c) => cellText(c, row))));
            return `${ctx.output.renderSection(s.title)}\n${table}`;
          }),
          ...(loaded.notes?.length ? [loaded.notes.map((n) => ctx.output.cliStyles.muted(n)).join("\n")] : []),
        ].join("\n\n");
        ctx.printResult({ data, metadata, freshness }, {
          text,
          ...(tabular ? {
            tables: {
              tables: sections.map((s) => csvTable(s.title, s.rows)),
              footer: footer(sections.map((s, i) => sectionKey(i, options.view)).join(" and ")),
            },
          } : {}),
        });
      }
    },
  };
  return command;
}

export const quantumCliCommand = createQuantumCliCommand();
