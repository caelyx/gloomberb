import { parseCsvLine } from "../shared/csv";
import type { DatedPoint } from "../shared/series";

export type RbaTableId = "f1" | "f2" | "f11.1";

export interface RbaSeries {
  id: string;
  title: string;
  units: string;
  points: DatedPoint[];
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** `07-Oct-2026` to `2026-10-07`. */
function rbaDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/);
  const month = match ? MONTHS[match[2]!] : undefined;
  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

/**
 * An RBA statistical table CSV: a title line, then labelled header rows
 * (Title, Description, Frequency, Type, Units, Source, Publication date,
 * Series ID), then one row per date. Blank cells are missing observations.
 */
export function parseRbaTable(text: string): Map<string, RbaSeries> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows = lines.map((line) => parseCsvLine(line));
  const headerRow = (label: string) => rows.find((cells) => cells[0]?.toLowerCase() === label.toLowerCase());
  const ids = headerRow("Series ID");
  if (!ids) throw new Error("RBA table format was not recognised");
  const titles = headerRow("Title") ?? [];
  const units = headerRow("Units") ?? [];
  const series = new Map<string, RbaSeries>();
  ids.forEach((id, index) => {
    if (index === 0 || !id) return;
    series.set(id, { id, title: titles[index] ?? id, units: units[index] ?? "", points: [] });
  });
  for (const cells of rows) {
    const date = cells[0] ? rbaDate(cells[0]) : null;
    if (!date) continue;
    ids.forEach((id, index) => {
      if (index === 0 || !id) return;
      const raw = cells[index]?.trim();
      if (!raw) return;
      const value = Number(raw);
      if (Number.isFinite(value)) series.get(id)!.points.push({ date, value });
    });
  }
  if (![...series.values()].some((entry) => entry.points.length > 0)) throw new Error("RBA table had no observations");
  return series;
}

/** The latest point on or before `date`, from points in ascending date order. */
export function valueOnOrBefore(points: readonly DatedPoint[], date: string): DatedPoint | null {
  let found: DatedPoint | null = null;
  for (const point of points) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

/** `days` calendar days before an ISO date. */
export function isoDaysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export interface Change {
  latest: DatedPoint | null;
  week: number | null;
  month: number | null;
  year: number | null;
}

/** Latest value and its change over a week, a month and a year (in the series' own units). */
export function changes(points: readonly DatedPoint[]): Change {
  const latest = points.at(-1) ?? null;
  if (!latest) return { latest, week: null, month: null, year: null };
  const delta = (days: number) => {
    const then = valueOnOrBefore(points, isoDaysBefore(latest.date, days));
    return then && then.date !== latest.date ? latest.value - then.value : null;
  };
  return { latest, week: delta(7), month: delta(30), year: delta(365) };
}

export type RbaGroup = "Policy" | "Money market" | "Government bonds" | "AUD";

export interface RbaSeriesDef {
  id: string;
  table: RbaTableId;
  label: string;
  group: RbaGroup;
  /** "%" for rates, "fx" for exchange rates, "index" for the TWI. */
  kind: "rate" | "fx" | "index";
}

/** The series the pane and the chart catalogue offer. (F1's OIS and Treasury note columns stopped in 2022 and 2013.) */
export const RBA_SERIES: readonly RbaSeriesDef[] = [
  { id: "FIRMMCRTD", table: "f1", label: "RBA cash rate target", group: "Policy", kind: "rate" },
  { id: "FIRMMCRID", table: "f1", label: "Interbank overnight cash rate", group: "Policy", kind: "rate" },
  { id: "FIRMMBAB30D", table: "f1", label: "1-month BBSW", group: "Money market", kind: "rate" },
  { id: "FIRMMBAB90D", table: "f1", label: "3-month BBSW", group: "Money market", kind: "rate" },
  { id: "FIRMMBAB180D", table: "f1", label: "6-month BBSW", group: "Money market", kind: "rate" },
  { id: "FCMYGBAG2D", table: "f2", label: "2-year government bond", group: "Government bonds", kind: "rate" },
  { id: "FCMYGBAG3D", table: "f2", label: "3-year government bond", group: "Government bonds", kind: "rate" },
  { id: "FCMYGBAG5D", table: "f2", label: "5-year government bond", group: "Government bonds", kind: "rate" },
  { id: "FCMYGBAG10D", table: "f2", label: "10-year government bond", group: "Government bonds", kind: "rate" },
  { id: "FCMYGBAGID", table: "f2", label: "Indexed government bond", group: "Government bonds", kind: "rate" },
  { id: "FXRUSD", table: "f11.1", label: "AUD/USD", group: "AUD", kind: "fx" },
  { id: "FXRTWI", table: "f11.1", label: "Trade-weighted index", group: "AUD", kind: "index" },
  { id: "FXREUR", table: "f11.1", label: "AUD/EUR", group: "AUD", kind: "fx" },
  { id: "FXRJY", table: "f11.1", label: "AUD/JPY", group: "AUD", kind: "fx" },
  { id: "FXRCR", table: "f11.1", label: "AUD/CNY", group: "AUD", kind: "fx" },
  { id: "FXRUKPS", table: "f11.1", label: "AUD/GBP", group: "AUD", kind: "fx" },
  { id: "FXRNZD", table: "f11.1", label: "AUD/NZD", group: "AUD", kind: "fx" },
];

export function findRbaSeries(id: string): RbaSeriesDef | null {
  return RBA_SERIES.find((def) => def.id === id.trim().toUpperCase()) ?? null;
}

/*
 * Monetary Policy Board meetings, from rba.gov.au/schedules-events/board-meeting-schedules.html
 * (checked 2026-10-08). Each runs over two days; the decision is published at
 * 2:30 pm Sydney time on the second day, which is the date listed here.
 */
export const RBA_DECISION_DATES: readonly string[] = [
  "2026-02-03", "2026-03-17", "2026-05-05", "2026-06-16", "2026-08-11", "2026-09-29", "2026-11-03", "2026-12-08",
  "2027-02-09", "2027-03-23", "2027-05-04", "2027-06-22", "2027-08-10", "2027-09-28", "2027-11-02", "2027-12-14",
];

export interface Decision {
  date: string;
  /** Percentage points; 0 for a hold. Null for a meeting still to come. */
  change: number | null;
  /** The target after the decision. */
  rate: number | null;
}

/**
 * Past decisions from the cash-rate target series (a change shows on the day
 * after the announcement, when it takes effect), and the meetings still to come.
 */
export function decisions(target: readonly DatedPoint[], today: string, dates = RBA_DECISION_DATES): Decision[] {
  return dates.map((date) => {
    if (date >= today) return { date, change: null, rate: null };
    const before = valueOnOrBefore(target, date);
    const after = valueOnOrBefore(target, isoDaysBefore(date, -7));
    if (!before || !after || after.date <= date) return { date, change: null, rate: before?.value ?? null };
    return { date, change: Math.round((after.value - before.value) * 100) / 100, rate: after.value };
  });
}
