import type { HeadlessPaneDefinition, HeadlessPaneRow } from "gloomberb/types/plugin";
import { loadBoard, loadMovers, type BoardRow } from "./client";
import { splitMovers } from "./model";
import { capLabel, level, pct } from "./format";

const num = (format: (value: number) => string) => (value: unknown) => (typeof value === "number" ? format(value) : "—");

function boardRows(rows: BoardRow[]): HeadlessPaneRow[] {
  return rows.map((row) => ({
    name: row.label, symbol: row.symbol, last: row.price, day: row.changePercent,
    week: row.returns.week, month: row.returns.month, ytd: row.returns.ytd, year: row.returns.year,
    quadrant: row.rotation?.quadrant ?? null,
  }));
}

const boardColumns = (withQuadrant: boolean) => [
  { key: "name", header: "Name" },
  { key: "last", header: "Last", align: "right" as const, format: num(level) },
  { key: "day", header: "1D", align: "right" as const, format: num((value) => pct(value)) },
  { key: "week", header: "1W", align: "right" as const, format: num((value) => pct(value, 1)) },
  { key: "month", header: "1M", align: "right" as const, format: num((value) => pct(value, 1)) },
  { key: "ytd", header: "YTD", align: "right" as const, format: num((value) => pct(value, 1)) },
  { key: "year", header: "1Y", align: "right" as const, format: num((value) => pct(value, 1)) },
  ...(withQuadrant ? [{ key: "quadrant", header: "Rotation" }] : []),
];

const moverColumns = [
  { key: "code", header: "Code" },
  { key: "name", header: "Company" },
  { key: "price", header: "Last", align: "right" as const, format: num((value) => value.toFixed(value < 1 ? 3 : 2)) },
  { key: "changePercent", header: "Chg", align: "right" as const, format: num((value) => pct(value)) },
  { key: "marketCap", header: "Mkt cap", align: "right" as const, format: (value: unknown) => capLabel(typeof value === "number" ? value : null) },
];

/** `gloomberb fn ASXM`: ASX indices, GICS sectors with rotation, and the day's biggest moves among the largest companies. */
export const boardHeadless = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [
    { key: "movers", description: "How many of the largest companies to scan for movers (0 to skip).", type: "integer", defaultValue: 100, minimum: 0, maximum: 200 },
  ],
  describe: "ASX market",
  async load(args, ctx) {
    const universe = Number(args.options.movers ?? 100);
    const [board, movers] = await Promise.all([
      loadBoard(ctx.marketData, { force: ctx.refresh }),
      universe > 0 ? loadMovers(ctx.marketData, { force: ctx.refresh, universe }).catch(() => null) : Promise.resolve([]),
    ]);
    const split = splitMovers(movers ?? []);
    return {
      sections: [
        { title: "Indices", columns: boardColumns(false), rows: boardRows(board.indices) },
        { title: "Sectors", columns: boardColumns(true), rows: boardRows(board.sectors) },
        ...(universe > 0 ? [
          { title: "Gainers", columns: moverColumns, rows: split.gainers as unknown as HeadlessPaneRow[] },
          { title: "Losers", columns: moverColumns, rows: split.losers as unknown as HeadlessPaneRow[] },
        ] : []),
      ],
      ...(board.errors.length || movers === null ? { errors: [...board.errors, ...(movers === null ? ["Movers unavailable"] : [])], complete: false } : {}),
    };
  },
} satisfies HeadlessPaneDefinition<"bundle">;
