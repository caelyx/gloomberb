import type { F16Bond, F16Table } from "./f16";

/** A yield at a standard maturity, in the shape Gloomberb's curve charts take. */
export interface CurvePoint {
  tenor: string;
  years: number;
  /** Per cent per annum; null when no bond lines bracket the tenor that day. */
  yield: number | null;
}

/** One bond line's closing yield on a session, placed by its time to maturity. */
export interface LineYield {
  years: number;
  yield: number;
}

export interface CurveSession {
  /** YYYY-MM-DD. */
  date: string;
  points: CurvePoint[];
}

export type LookbackId = "1D" | "1W" | "1M";

export interface AcgbSnapshot {
  /** The RBA's publication date for the file the curve came from. */
  published: string | null;
  latest: CurveSession;
  lookbacks: Partial<Record<LookbackId, CurveSession>>;
}

const TENORS: ReadonlyArray<{ tenor: string; years: number }> = [
  { tenor: "1Y", years: 1 }, { tenor: "2Y", years: 2 }, { tenor: "3Y", years: 3 }, { tenor: "4Y", years: 4 },
  { tenor: "5Y", years: 5 }, { tenor: "7Y", years: 7 }, { tenor: "10Y", years: 10 }, { tenor: "15Y", years: 15 },
  { tenor: "20Y", years: 20 }, { tenor: "25Y", years: 25 }, { tenor: "30Y", years: 30 },
];

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

function utc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Years from a session to a maturity date, on an actual/365.25 count. */
function residualYears(session: string, maturity: string): number {
  return (utc(maturity) - utc(session)) / DAY_MS / YEAR_DAYS;
}

/** The lines quoted on a session, shortest first. */
function lineYields(bonds: readonly F16Bond[], yields: Readonly<Record<string, number>>, session: string): LineYield[] {
  return bonds.flatMap((bond) => {
    const value = yields[bond.seriesId];
    return value == null ? [] : [{ years: residualYears(session, bond.maturity), yield: value }];
  }).sort((left, right) => left.years - right.years);
}

/**
 * In its final days a line's quote stops tracking the curve: the September
 * 2026 line was 4.43% two weeks out and 2.945% on its maturity date. Three
 * months keeps those days out with room to spare and still leaves a line
 * below 1Y on every session since 2024.
 */
const MIN_RESIDUAL_YEARS = 0.25;

/**
 * The yield at `years` read off one session's bond lines (shortest first):
 * linear in yield to maturity between the two lines either side, as the RBA's
 * own interpolated table F2 is. No extrapolation past either end.
 */
export function interpolateTenor(lines: readonly LineYield[], years: number): number | null {
  const usable = lines.filter((line) => line.years >= MIN_RESIDUAL_YEARS);
  const above = usable.findIndex((line) => line.years >= years);
  if (above < 0) return null;
  const upper = usable[above]!;
  if (upper.years === years) return upper.yield;
  const lower = usable[above - 1];
  if (!lower) return null;
  return lower.yield + (upper.yield - lower.yield) * (years - lower.years) / (upper.years - lower.years);
}

function curveOn(table: F16Table, session: string): CurveSession | null {
  const row = table.rows.find((entry) => entry.date === session);
  if (!row) return null;
  const lines = lineYields(table.bonds, row.yields, session);
  return { date: session, points: TENORS.map(({ tenor, years }) => ({ tenor, years, yield: interpolateTenor(lines, years) })) };
}

/** The last session on or before `date` with any quote. */
function sessionOnOrBefore(table: F16Table, date: string): string | null {
  for (let index = table.rows.length - 1; index >= 0; index--) {
    const row = table.rows[index]!;
    if (row.date <= date && Object.keys(row.yields).length > 0) return row.date;
  }
  return null;
}

function shiftDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The same day a month earlier, or that month's last day when it is shorter. */
function monthBefore(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** The latest session's curve and the sessions a day, a week and a month before it. */
export function acgbSnapshot(table: F16Table): AcgbSnapshot | null {
  const latestDate = sessionOnOrBefore(table, "9999-12-31");
  const latest = latestDate ? curveOn(table, latestDate) : null;
  if (!latestDate || !latest) return null;
  const targets: Record<LookbackId, string> = {
    "1D": shiftDays(latestDate, -1),
    "1W": shiftDays(latestDate, -7),
    "1M": monthBefore(latestDate),
  };
  const lookbacks: Partial<Record<LookbackId, CurveSession>> = {};
  for (const id of Object.keys(targets) as LookbackId[]) {
    const date = sessionOnOrBefore(table, targets[id]);
    const curve = date ? curveOn(table, date) : null;
    if (curve) lookbacks[id] = curve;
  }
  return { published: table.published, latest, lookbacks };
}
