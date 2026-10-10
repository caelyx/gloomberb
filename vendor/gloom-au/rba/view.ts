import type { RbaTables } from "./client";
import type { DatedPoint } from "../shared/series";
import { RBA_SERIES, changes, decisions, type Decision, type RbaSeriesDef } from "./model";

export interface RateRow {
  id: string;
  label: string;
  group: string;
  kind: RbaSeriesDef["kind"];
  latest: number | null;
  asOf: string | null;
  /** Rates: basis points. AUD: percent change. */
  week: number | null;
  month: number | null;
  year: number | null;
}

function tableFor(tables: RbaTables, def: RbaSeriesDef) {
  return def.table === "f1" ? tables.f1 : def.table === "f2" ? tables.f2 : tables.fx;
}

/** Every observation of one series, oldest first; empty when its table failed. */
export function seriesPoints(tables: RbaTables, id: string): DatedPoint[] {
  const def = RBA_SERIES.find((entry) => entry.id === id);
  return def ? tableFor(tables, def).get(def.id)?.points ?? [] : [];
}

export function rateRows(tables: RbaTables, groups: ReadonlyArray<RbaSeriesDef["group"]>): RateRow[] {
  return RBA_SERIES.filter((def) => groups.includes(def.group)).map((def) => {
    const points = tableFor(tables, def).get(def.id)?.points ?? [];
    const change = changes(points);
    const latest = change.latest?.value ?? null;
    const scale = (delta: number | null) => {
      if (delta == null || latest == null) return null;
      // Rates move in basis points; exchange rates and the TWI in percent.
      return def.kind === "rate" ? Math.round(delta * 100 * 10) / 10 : (delta / (latest - delta)) * 100;
    };
    return {
      id: def.id,
      label: def.label,
      group: def.group,
      kind: def.kind,
      latest,
      asOf: change.latest?.date ?? null,
      week: scale(change.week),
      month: scale(change.month),
      year: scale(change.year),
    };
  });
}

export interface BoardView {
  target: number | null;
  targetAsOf: string | null;
  lastChange: Decision | null;
  next: string | null;
  daysToNext: number | null;
  meetings: Decision[];
}

export function boardView(tables: RbaTables, today: string): BoardView {
  const target = tables.f1.get("FIRMMCRTD")?.points ?? [];
  const meetings = decisions(target, today);
  const latest = target.at(-1) ?? null;
  const next = meetings.find((meeting) => meeting.date >= today)?.date ?? null;
  const lastChange = [...meetings].reverse().find((meeting) => meeting.change != null && meeting.change !== 0) ?? null;
  return {
    target: latest?.value ?? null,
    targetAsOf: latest?.date ?? null,
    lastChange,
    next,
    daysToNext: next ? Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null,
    meetings,
  };
}

export function formatRate(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

export function formatLevel(row: Pick<RateRow, "kind" | "latest">): string {
  if (row.latest == null) return "—";
  if (row.kind === "rate") return formatRate(row.latest);
  return row.kind === "index" || row.latest >= 100 ? row.latest.toFixed(2) : row.latest.toFixed(4);
}

/** Signed as shown: a change that rounds to zero prints as 0, not -0 or +0. */
export function formatChange(row: Pick<RateRow, "kind">, value: number | null): string {
  if (value == null) return "—";
  const digits = row.kind === "rate" ? 0 : 2;
  const shown = Number(value.toFixed(digits)) || 0;
  return `${shown > 0 ? "+" : ""}${shown.toFixed(digits)}${row.kind === "rate" ? "" : "%"}`;
}
