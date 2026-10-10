import type { HeadlessPaneDefinition, HeadlessPaneRow } from "gloomberb/types/plugin";
import { loadRbaTables } from "./client";
import { refreshNotice } from "../shared/cache-status";
import { sydneyToday } from "../shared/time";
import { boardView, formatChange, formatLevel, formatRate, rateRows, type RateRow } from "./view";

function rows(list: RateRow[]): HeadlessPaneRow[] {
  return list.map((row) => ({ series: row.label, id: row.id, latest: row.latest, asOf: row.asOf, week: row.week, month: row.month, year: row.year, kind: row.kind }));
}

const rateColumns = (unit: string) => [
  { key: "series", header: "Series" },
  { key: "latest", header: "Latest", align: "right" as const, format: (value: unknown, row: HeadlessPaneRow) => formatLevel({ kind: row.kind as RateRow["kind"], latest: value as number | null }) },
  { key: "asOf", header: "As of" },
  ...(["week", "month", "year"] as const).map((key) => ({
    key,
    header: `${key === "week" ? "1W" : key === "month" ? "1M" : "1Y"} ${unit}`,
    align: "right" as const,
    format: (value: unknown, row: HeadlessPaneRow) => formatChange({ kind: row.kind as RateRow["kind"] }, value as number | null),
  })),
];

/** `gloomberb fn RBA`: rates, the AUD and the board calendar. */
export const rbaHeadless = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  describe: "RBA rates and the AUD",
  // RBA statistical tables: published each business day, F2 about a week behind.
  freshness: { source: "RBA", status: "not-a-feed", basis: "statistical tables" },
  async load(_args, ctx) {
    const { tables, errors, meta } = await loadRbaTables({ force: ctx.refresh, signal: ctx.signal });
    const board = boardView(tables, sydneyToday());
    return {
      sections: [
        { title: "Board", entries: [
          { key: "target", label: "Cash rate target", value: board.target, formatted: formatRate(board.target) },
          { key: "lastChange", label: "Last change", value: board.lastChange?.change ?? null, formatted: board.lastChange?.change == null ? "—" : `${board.lastChange.change > 0 ? "+" : ""}${Math.round(board.lastChange.change * 100)} bp on ${board.lastChange.date}` },
          { key: "next", label: "Next decision", value: board.next, formatted: board.next ? `${board.next} (${board.daysToNext} days)` : "—" },
        ] },
        { title: "Rates", columns: rateColumns("bp"), rows: rows(rateRows(tables, ["Policy", "Money market", "Government bonds"])) },
        { title: "AUD", columns: rateColumns("%"), rows: rows(rateRows(tables, ["AUD"])) },
      ],
      ...(errors.length ? { errors, complete: false } : {}),
      ...(meta?.refreshError ? { notes: refreshNotice(meta) } : {}),
    };
  },
} satisfies HeadlessPaneDefinition<"bundle">;
