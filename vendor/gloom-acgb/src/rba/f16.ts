// papaparse's package main carries a Node stream reader. The Gloomberb host
// imports the plugin before compiling its browser build, and that build then
// reuses the main the runtime resolved; the min build has no Node code.
import Papa from "papaparse/papaparse.min.js";

/**
 * RBA statistical table F16, "Indicative Mid Rates of Selected Australian
 * Government Securities": one column per bond line, one row per day.
 *
 * The file opens with labelled header rows (Title, Description, ..., Series
 * ID) and blank lines, then dated rows that drop their trailing empty fields.
 * Columns are in maturity order, so a new line is inserted mid-row; every
 * value is keyed by its series id, never by its position.
 */

export interface F16Bond {
  seriesId: string;
  /** YYYY-MM-DD. */
  maturity: string;
}

export interface F16Row {
  /** YYYY-MM-DD. */
  date: string;
  /** Per cent per annum, by series id; a line with no quote that day is absent. */
  yields: Readonly<Record<string, number>>;
}

export interface F16Table {
  /** The RBA's publication date for the file, YYYY-MM-DD. */
  published: string | null;
  /** Treasury Bonds only; Treasury Indexed Bonds quote real yields and are left out. */
  bonds: F16Bond[];
  /** Oldest first. */
  rows: F16Row[];
}

export class F16FormatError extends Error {
  constructor(message: string) {
    super(`Australian bond yield file is not in the expected format: ${message}`);
    this.name = "F16FormatError";
  }
}

const MONTHS: Readonly<Record<string, string>> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const RBA_DATE = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/;
/** `Treasury Bond 169 4.75% 21-Jun-2054`, capturing the maturity; indexed bonds do not match. */
const TREASURY_BOND = /^Treasury Bond \d+ \d+(?:\.\d+)?% (\d{2}-[A-Za-z]{3}-\d{4})$/;

/** `21-Jun-2054` to `2054-06-21`; null for anything else. */
export function rbaDate(value: string): string | null {
  const match = RBA_DATE.exec(value.trim());
  const month = match && MONTHS[match[2]!.toLowerCase()];
  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

export function parseF16(text: string): F16Table {
  const { data } = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  const labelled = (label: string) => data.find((row) => row[0]?.trim() === label);
  const descriptions = labelled("Description");
  const seriesIds = labelled("Series ID");
  if (!descriptions || !seriesIds) throw new F16FormatError("no Description or Series ID row");

  const columns: Array<{ index: number; seriesId: string }> = [];
  const bonds: F16Bond[] = [];
  for (let index = 1; index < seriesIds.length; index++) {
    const seriesId = seriesIds[index]?.trim();
    const match = TREASURY_BOND.exec(descriptions[index]?.trim() ?? "");
    const maturity = match && rbaDate(match[1]!);
    if (!seriesId || !maturity) continue;
    columns.push({ index, seriesId });
    bonds.push({ seriesId, maturity });
  }
  if (bonds.length === 0) throw new F16FormatError("no Treasury Bond columns");

  const rows: F16Row[] = [];
  for (const row of data) {
    const date = rbaDate(row[0] ?? "");
    if (!date) continue;
    const yields: Record<string, number> = {};
    for (const { index, seriesId } of columns) {
      const cell = row[index]?.trim();
      const value = cell ? Number(cell) : Number.NaN;
      if (Number.isFinite(value)) yields[seriesId] = value;
    }
    rows.push({ date, yields });
  }
  rows.sort((left, right) => left.date.localeCompare(right.date));

  const published = labelled("Publication date")?.slice(1).map(rbaDate).find((date) => date !== null) ?? null;
  return { published, bonds, rows };
}
