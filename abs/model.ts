import { decodeHtmlEntities } from "gloomberb/utils";
import { parseCsvLine } from "../shared/csv";
import type { DatedPoint } from "../shared/series";

export interface AbsPoint extends DatedPoint {
  /** As ABS labels it: `2026-08` or `2026-Q2`. */
  period: string;
}

export interface AbsSeriesDef {
  id: string;
  label: string;
  group: "Inflation" | "Labour" | "Wages" | "Growth";
  flow: string;
  key: string;
  frequency: "monthly" | "quarterly";
  /** "%" for rates and growth; "k" for thousands of people. */
  unit: "%" | "k";
  /** Derived from a level series rather than read directly. */
  derive?: "yoy" | "change";
}

/*
 * SDMX keys checked against data.api.abs.gov.au on 2026-10-08. CPI is the
 * monthly CPI (the full monthly measure that replaced the quarterly headline
 * in late 2025).
 */
export const ABS_SERIES: readonly AbsSeriesDef[] = [
  { id: "cpi", label: "CPI, annual", group: "Inflation", flow: "ABS,CPI,2.0.0", key: "3.10001.10.50.M", frequency: "monthly", unit: "%" },
  { id: "cpi-trimmed-mean", label: "Trimmed mean CPI, annual", group: "Inflation", flow: "ABS,CPI,2.0.0", key: "3.999902.20.50.M", frequency: "monthly", unit: "%" },
  { id: "cpi-weighted-median", label: "Weighted median CPI, annual", group: "Inflation", flow: "ABS,CPI,2.0.0", key: "3.999903.20.50.M", frequency: "monthly", unit: "%" },
  { id: "unemployment", label: "Unemployment rate", group: "Labour", flow: "ABS,LF,1.0.0", key: "M13.3.1599.20.AUS.M", frequency: "monthly", unit: "%" },
  { id: "participation", label: "Participation rate", group: "Labour", flow: "ABS,LF,1.0.0", key: "M12.3.1599.20.AUS.M", frequency: "monthly", unit: "%" },
  { id: "employment-change", label: "Employment, monthly change", group: "Labour", flow: "ABS,LF,1.0.0", key: "M3.3.1599.20.AUS.M", frequency: "monthly", unit: "k", derive: "change" },
  { id: "wpi", label: "Wage price index, annual", group: "Wages", flow: "ABS,WPI,1.2.0", key: "3.THRPEB.7.TOT.20.AUS.Q", frequency: "quarterly", unit: "%" },
  { id: "gdp-qoq", label: "Real GDP, quarterly", group: "Growth", flow: "ABS,ANA_AGG,1.0.0", key: "M2.GPM.20.AUS.Q", frequency: "quarterly", unit: "%" },
  { id: "gdp-yoy", label: "Real GDP, annual", group: "Growth", flow: "ABS,ANA_AGG,1.0.0", key: "M1.GPM.20.AUS.Q", frequency: "quarterly", unit: "%", derive: "yoy" },
];

export function findAbsSeries(id: string): AbsSeriesDef | null {
  return ABS_SERIES.find((def) => def.id === id.trim().toLowerCase()) ?? null;
}

/** `2026-08` → `2026-08-01`; `2026-Q2` → `2026-04-01` (the start of the period). */
export function periodDate(period: string): string | null {
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[1]}-${month[2]}-01`;
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return `${quarter[1]}-${String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  return null;
}

/** An SDMX-CSV response for a single series key: one row per period. */
export function parseSdmxCsv(text: string): AbsPoint[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0] ? parseCsvLine(lines[0]) : [];
  const periodAt = header.indexOf("TIME_PERIOD");
  const valueAt = header.indexOf("OBS_VALUE");
  if (periodAt < 0 || valueAt < 0) throw new Error("ABS data format was not recognised");
  const points: AbsPoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const period = cells[periodAt] ?? "";
    const date = periodDate(period);
    const value = Number(cells[valueAt]);
    if (date && cells[valueAt] !== "" && Number.isFinite(value)) points.push({ period, date, value });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** Year-on-year percent change of a level series, `lag` periods apart. */
export function yearOnYear(points: readonly AbsPoint[], lag: number): AbsPoint[] {
  return points.slice(lag).flatMap((point, index) => {
    const then = points[index]!;
    return then.value === 0 ? [] : [{ ...point, value: Math.round(((point.value / then.value) - 1) * 10_000) / 100 }];
  });
}

/** Period-on-period change of a level series. */
export function periodChange(points: readonly AbsPoint[]): AbsPoint[] {
  return points.slice(1).map((point, index) => ({ ...point, value: Math.round((point.value - points[index]!.value) * 10) / 10 }));
}

export function derive(def: AbsSeriesDef, raw: readonly AbsPoint[]): AbsPoint[] {
  if (def.derive === "yoy") return yearOnYear(raw, def.frequency === "quarterly" ? 4 : 12);
  if (def.derive === "change") return periodChange(raw);
  return [...raw];
}

export interface AbsRelease {
  /** UTC ms. */
  at: number;
  /** As ABS prints it, e.g. "Thursday 15 October 2026 11:30am AEDT". */
  when: string;
  title: string;
}

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

const RELEASE_STAMP = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (\d{1,2}) ([A-Z][a-z]+) (\d{4}) (\d{1,2}):(\d{2})(am|pm) (AEDT|AEST)$/;

/**
 * The ABS future releases page: each release is a date line ("Thursday 15
 * October 2026 11:30am AEDT") followed by its title.
 */
export function parseReleaseCalendar(html: string): AbsRelease[] {
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((line) => decodeHtmlEntities(line).replace(/\s+/g, " ").trim())
    .filter((line) => line && line !== "|");
  const releases: AbsRelease[] = [];
  lines.forEach((line, index) => {
    const match = line.match(RELEASE_STAMP);
    const title = lines[index + 1];
    if (!match || !title || RELEASE_STAMP.test(title) || /^updated information$/i.test(title)) return;
    const month = MONTHS[match[3]!];
    if (!month) return;
    const hour = Number(match[5]) % 12 + (match[7] === "pm" ? 12 : 0);
    const offsetHours = match[8] === "AEDT" ? 11 : 10;
    const at = Date.UTC(Number(match[4]), month - 1, Number(match[2]), hour - offsetHours, Number(match[6]));
    releases.push({ at, when: line, title });
  });
  // The ABS always has something scheduled; finding nothing means the page changed shape.
  if (releases.length === 0) throw new Error("ABS release calendar format was not recognised");
  const seen = new Set<string>();
  return releases
    .filter((release) => {
      const key = `${release.at}|${release.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.at - b.at);
}

/** The headline releases a markets user watches. */
export function isHeadlineRelease(title: string): boolean {
  return /^(Consumer Price Index|Monthly Consumer Price Index|Labour Force, Australia|Wage Price Index|Australian National Accounts: National Income|Business Indicators|Monthly Household Spending|Building Approvals|International Trade in Goods|Balance of Payments|Retail Trade|Job Vacancies)/i.test(title);
}
