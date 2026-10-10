import { parseCsvLine } from "../shared/csv";

export const ASIC_SHORTS_BASE = "https://download.asic.gov.au/short-selling";

/** One trading day of ASIC's aggregated short position report. */
export interface ShortDay {
  /** ISO date the positions are as at (ASIC publishes them four trading days later). */
  date: string;
  rows: ShortRow[];
}

export interface ShortRow {
  code: string;
  /** ASIC's product description, e.g. "BHP GROUP LIMITED ORDINARY". */
  product: string;
  shortPositions: number;
  onIssue: number;
  /** Percent of the product on issue, e.g. 1.58 for 1.58%. */
  percent: number;
}

export interface ReportFile {
  date: string;
  url: string;
}

/** `20261002` to `2026-10-02`. */
function isoFromCompact(value: number | string): string | null {
  const text = String(value);
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
}

/**
 * `short-selling-data.json`: every published day with its file version. A
 * corrected day is listed again with a higher version; the highest wins.
 * Newest first.
 */
export function parseReportIndex(payload: unknown): ReportFile[] {
  if (!Array.isArray(payload)) throw new Error("ASIC short position index format was not recognised");
  const best = new Map<string, { version: string; compact: string }>();
  for (const entry of payload as Array<{ date?: unknown; version?: unknown }>) {
    const compact = String(entry?.date ?? "");
    const date = isoFromCompact(compact);
    const version = typeof entry?.version === "string" && /^\d{3}$/.test(entry.version) ? entry.version : null;
    if (!date || !version) continue;
    const current = best.get(date);
    if (!current || version > current.version) best.set(date, { version, compact });
  }
  if (best.size === 0) throw new Error("ASIC short position index was empty");
  return [...best.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, { version, compact }]) => ({ date, url: `${ASIC_SHORTS_BASE}/RR${compact}-${version}-SSDailyAggShortPos.csv` }));
}

/** Drops ASIC's class suffix ("ORDINARY", "FULLY PAID") for display. */
export function productName(product: string): string {
  return product
    .replace(/\s+(ORDINARY|FULLY PAID.*|UNITS FULLY PAID|CDI .*|STAPLED .*)$/i, "")
    // Funds: "… C ETF ETF UNITS" reads "… C ETF", and "… UNITS" alone is dropped like "ORDINARY".
    .replace(/(\s+ETF)?\s+ETF\s+UNITS$/i, " ETF")
    .replace(/\s+UNITS$/i, "")
    .replace(/\.{2,}$/, ".")
    .trim() || product;
}

export function parseShortCsv(text: string, date: string): ShortDay {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0] ? parseCsvLine(lines[0]).map((cell) => cell.toLowerCase()) : [];
  const at = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));
  const codeAt = at(/product code/);
  const productAt = at(/^product$/);
  const shortAt = at(/reported short/);
  const issueAt = at(/total product in issue/);
  const percentAt = at(/% of total/);
  if ([codeAt, productAt, shortAt, issueAt, percentAt].some((index) => index < 0)) {
    throw new Error("ASIC short position report format was not recognised");
  }
  const rows: ShortRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const code = cells[codeAt]?.trim().toUpperCase() ?? "";
    const shortPositions = Number(cells[shortAt]);
    const onIssue = Number(cells[issueAt]);
    const percent = Number(cells[percentAt]);
    if (!/^[A-Z0-9]{3,6}$/.test(code) || !Number.isFinite(shortPositions) || !Number.isFinite(percent)) continue;
    rows.push({
      code,
      product: cells[productAt]?.trim() ?? code,
      shortPositions,
      onIssue: Number.isFinite(onIssue) ? onIssue : 0,
      percent,
    });
  }
  if (rows.length === 0) throw new Error("ASIC short position report was empty");
  return { date, rows };
}

export interface ShortHistoryPoint {
  date: string;
  percent: number | null;
  shortPositions: number | null;
}

/** One code across days, newest first. A day without the code is a gap (null), not zero. */
export function historyFor(days: readonly ShortDay[], code: string): ShortHistoryPoint[] {
  return [...days]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((day) => {
      const row = day.rows.find((candidate) => candidate.code === code);
      return { date: day.date, percent: row?.percent ?? null, shortPositions: row?.shortPositions ?? null };
    });
}

/** A history oldest first, for a chart: a day without a report is a gap (null), not zero. */
export function reportedSeries(points: readonly ShortHistoryPoint[]): Array<{ date: string; value: number | null }> {
  return points
    .map((point) => ({ date: point.date, value: point.percent }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The row a history opens on: the one asked for, else the newest reported day (an unreported day has no point on the chart). */
export function defaultHistoryRow<P extends ShortHistoryPoint>(rows: readonly P[], selectedDate: string | null): P | null {
  return rows.find((row) => row.date === selectedDate) ?? rows.find((row) => row.percent != null) ?? rows[0] ?? null;
}

/**
 * The 1W change of a product on the latest report: "new" when the report a
 * week earlier did not list it (a new listing, or one below the threshold),
 * since counting from zero would rank its whole position as a jump; null
 * without that report.
 */
export function weekChange(now: number, weekAgo: ReadonlyMap<string, number> | null, code: string): number | "new" | null {
  if (!weekAgo) return null;
  const then = weekAgo.get(code);
  return then == null ? "new" : now - then;
}

/** Percentage-point change from `then` to `now`, when both are known. */
export function changePoints(now: number | null | undefined, then: number | null | undefined): number | null {
  return now == null || then == null ? null : now - then;
}

/**
 * Which published days a history window needs: every day for a month or a
 * quarter, one a week for a year so a cold cache stays a few dozen files.
 */
export function selectHistoryFiles(index: readonly ReportFile[], window: ShortWindow): ReportFile[] {
  if (index.length === 0) return [];
  const latest = Date.parse(`${index[0]!.date}T00:00:00Z`);
  const days = window === "1M" ? 31 : window === "3M" ? 92 : 366;
  const inWindow = index.filter((file) => latest - Date.parse(`${file.date}T00:00:00Z`) <= days * 86_400_000);
  if (window !== "1Y") return inWindow;
  const weekly: ReportFile[] = [];
  let lastKept = Number.POSITIVE_INFINITY;
  for (const file of inWindow) {
    const at = Date.parse(`${file.date}T00:00:00Z`);
    if (lastKept - at >= 6 * 86_400_000) {
      weekly.push(file);
      lastKept = at;
    }
  }
  return weekly;
}

export type ShortWindow = "1M" | "3M" | "1Y";
