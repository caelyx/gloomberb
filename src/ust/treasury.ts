// See src/rba/f16.ts for why the min build.
import Papa from "papaparse/papaparse.min.js";
import type { CurvePoint, CurveSession } from "../rba/curve";

/**
 * US Treasury daily par yield curve, one CSV per calendar year:
 * `Date,"1 Mo",...,"30 Yr"` with `MM/DD/YYYY` dates, newest first.
 */

export const TREASURY_HOST = "home.treasury.gov";

/** The tenors drawn beside the ACGB curve, which starts at one year. */
const COLUMNS: ReadonlyArray<{ column: string; tenor: string; years: number }> = [
  { column: "1 Yr", tenor: "1Y", years: 1 }, { column: "2 Yr", tenor: "2Y", years: 2 },
  { column: "3 Yr", tenor: "3Y", years: 3 }, { column: "5 Yr", tenor: "5Y", years: 5 },
  { column: "7 Yr", tenor: "7Y", years: 7 }, { column: "10 Yr", tenor: "10Y", years: 10 },
  { column: "20 Yr", tenor: "20Y", years: 20 }, { column: "30 Yr", tenor: "30Y", years: 30 },
];

/** The latest US session at most this many days before the requested date stands in for it. */
const MAX_GAP_DAYS = 10;

export function treasuryCsvUrl(year: number): string {
  return `https://${TREASURY_HOST}/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all`
    + `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

/** `09/30/2026` to `2026-09-30`. */
function treasuryDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

export function parseTreasuryCsv(text: string): CurveSession[] {
  const { data } = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  return data.flatMap((row) => {
    const date = treasuryDate(row.Date ?? "");
    if (!date) return [];
    const points: CurvePoint[] = COLUMNS.map(({ column, tenor, years }) => {
      const value = Number(row[column]?.trim() || Number.NaN);
      return { tenor, years, yield: Number.isFinite(value) ? value : null };
    });
    return points.some((point) => point.yield != null) ? [{ date, points }] : [];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

/** The last session on or before `date`, within MAX_GAP_DAYS of it. */
export function sessionOnOrBefore(sessions: readonly CurveSession[], date: string): CurveSession | null {
  const floor = new Date(Date.parse(`${date}T00:00:00Z`) - MAX_GAP_DAYS * 86_400_000).toISOString().slice(0, 10);
  return sessions.findLast((session) => session.date <= date && session.date >= floor) ?? null;
}
