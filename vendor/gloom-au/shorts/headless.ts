import type { HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { asxCodeFromSymbol } from "../shared/asx";
import { refreshNotice } from "../shared/cache-status";
import { loadLatestShorts, loadShortHistory } from "./client";
import { historyFor, productName, weekChange, type ShortWindow } from "./model";

const pct = (value: unknown) => (typeof value === "number" ? `${value.toFixed(2)}%` : "");
const pp = (value: unknown) => (typeof value === "number" ? `${value > 0 ? "+" : ""}${value.toFixed(2)}` : typeof value === "string" ? value : "");

/** `gloomberb fn ASXS` for the most shorted products, `gloomberb fn ASXS PLS.AX` for one history. */
export const shortsHeadless = {
  shape: "rows",
  argument: { kind: "ticker", placeholder: "ASX ticker", optional: true, description: "An ASX listing; without one, the most shorted products." },
  options: [
    { key: "top", description: "Market view: how many products, most shorted first.", type: "integer", defaultValue: 50, minimum: 1, maximum: 1000 },
    { key: "window", description: "Ticker view: history window.", type: "enum", values: [{ value: "1M" }, { value: "3M" }, { value: "1Y" }], defaultValue: "1M" },
  ],
  describe: (args) => (args.symbols[0] ? `ASIC short positions | ${args.symbols[0]}` : "ASIC short positions | most shorted"),
  // ASIC's daily report, four business days behind.
  freshness: { source: "ASIC", status: "not-a-feed", basis: "daily short position reports" },
  async load(args, ctx) {
    const symbol = args.symbols[0];
    if (!symbol) {
      const { latest, weekAgo, names, meta } = await loadLatestShorts({ force: ctx.refresh, signal: ctx.signal });
      const before = weekAgo ? new Map(weekAgo.rows.map((row) => [row.code, row.percent])) : null;
      const top = Number(args.options.top ?? 50);
      return {
        columns: [
          { key: "code", header: "Code" },
          { key: "name", header: "Company" },
          { key: "percent", header: "Short %", align: "right", format: pct },
          { key: "weekChange", header: "1W pp", align: "right", format: pp },
          { key: "shortPositions", header: "Short", align: "right" },
        ],
        rows: [...latest.rows].sort((a, b) => b.percent - a.percent).slice(0, top).map((row) => ({
          code: row.code,
          name: names.get(row.code) ?? productName(row.product),
          percent: row.percent,
          weekChange: weekChange(row.percent, before, row.code),
          shortPositions: row.shortPositions,
        })),
        metadata: { asAt: latest.date },
        ...(meta.refreshError ? { notes: refreshNotice(meta) } : {}),
      };
    }
    const code = asxCodeFromSymbol(symbol) ?? asxCodeFromSymbol(symbol, "ASX");
    if (!code) return { rows: [], unavailableSymbols: [symbol], errors: [`${symbol} is not an ASX listing.`] };
    const window = (args.options.window as ShortWindow | undefined) ?? "1M";
    const points = historyFor((await loadShortHistory(window, { force: ctx.refresh, signal: ctx.signal })).days, code);
    return {
      columns: [
        { key: "date", header: "As at" },
        { key: "percent", header: "Short %", align: "right", format: (value) => (value == null ? "not reported" : pct(value)) },
        { key: "shortPositions", header: "Short", align: "right" },
      ],
      rows: points.map((point) => ({ date: point.date, percent: point.percent, shortPositions: point.shortPositions })),
      symbols: [symbol],
      metadata: { code, window },
    };
  },
} satisfies HeadlessPaneDefinition<"rows">;
