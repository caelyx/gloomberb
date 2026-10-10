import type { HeadlessPaneDefinition, HeadlessPaneRow } from "gloomberb/types/plugin";
import { capLabel, level, pct } from "../board/format";
import { loadHeatmap, type HeatmapBoard } from "./client";
import { capWeightedMove, summarizeSectors, toSource, topMovers, toUniverse, universeLabel, type HeatmapAsset } from "./model";

const num = (format: (value: number) => string) => (value: unknown) => (typeof value === "number" ? format(value) : "—");

/** What the board is made of, in words: the index, or the ranking that stood in for it and why. */
export function constituentsLabel(board: HeatmapBoard): string {
  const count = board.universe === "asx50" ? 50 : 200;
  if (board.universe === "sectors" && board.sectorsUnavailable) return "Sectors sized evenly (ASX company directory unavailable)";
  const what = board.universe === "sectors"
    ? (board.ranked ? "Sector weights from the top 200 by market cap" : "Sector weights from S&P/ASX 200 members")
    : (board.ranked ? `Top ${count} ASX companies by market cap` : `S&P/ASX ${count} members`);
  return board.fallback ? `${what} (TradingView unavailable: ${board.fallback})` : what;
}

const moverColumns = [
  { key: "code", header: "Code" },
  { key: "name", header: "Company" },
  { key: "sector", header: "Sector" },
  { key: "price", header: "Last", align: "right" as const, format: num((value) => value.toFixed(value < 1 ? 3 : 2)) },
  { key: "changePercent", header: "Chg", align: "right" as const, format: num((value) => pct(value)) },
  { key: "size", header: "Mkt cap", align: "right" as const, format: (value: unknown) => capLabel(typeof value === "number" ? value : null) },
];

const moverRows = (assets: HeatmapAsset[]): HeadlessPaneRow[] => assets.map((asset) => ({
  code: asset.label, name: asset.name, sector: asset.sector, price: asset.price, changePercent: asset.changePercent, size: asset.size,
}));

/** `gloomberb fn HMA`: the board's constituents, its sector averages and its biggest moves. */
export const heatmapHeadless = {
  shape: "bundle",
  description: "ASX 50, ASX 200 or GICS sector index moves with market-cap-weighted sector averages and the biggest gainers and losers. Weights are company market caps, not index weights, so foreign-domiciled companies such as Newmont weigh more than in the index.",
  argument: { kind: "none" },
  options: [
    {
      key: "universe",
      description: "Which board: the ASX 50, the ASX 200, or the 11 GICS sector indices.",
      type: "enum",
      values: [{ value: "asx50", aliases: ["50"] }, { value: "asx200", aliases: ["200"] }, { value: "sectors" }],
      defaultValue: "asx50",
      settingKey: "universe",
    },
    {
      key: "source",
      description: "Index members from TradingView's scanner, or the largest companies by market cap.",
      type: "enum",
      values: [{ value: "tradingview" }, { value: "market-cap", aliases: ["top"] }],
      defaultValue: "tradingview",
      settingKey: "source",
    },
  ],
  describe: "ASX heatmap",
  async load(args, ctx) {
    const universe = toUniverse(args.options.universe ?? ctx.settings?.universe);
    const source = toSource(args.options.source ?? ctx.settings?.source);
    const board = await loadHeatmap(ctx.marketData, { universe, source, force: ctx.refresh });
    const move = capWeightedMove(board.assets);
    const summary = {
      title: "Board",
      entries: [
        { label: "Universe", value: universeLabel(universe, board.ranked) },
        { label: "Constituents", value: constituentsLabel(board) },
        { label: "Tiles", value: board.assets.length },
        { label: "Up / down", value: `${board.assets.filter((asset) => (asset.changePercent ?? 0) > 0).length} / ${board.assets.filter((asset) => (asset.changePercent ?? 0) < 0).length}` },
        ...(universe === "sectors" ? [] : [{ label: "Cap-weighted move", value: move, formatted: pct(move) }]),
      ],
    };
    const notes = [
      ...(board.fallback ? [`TradingView was unavailable (${board.fallback}), so ${universe === "sectors" ? "sector weights come from the largest 200 ASX companies by market cap" : "the board shows the largest ASX companies by market cap instead of the index"}.`] : []),
      ...(board.membersAsOf ? [`TradingView's scanner was unavailable, so index members are from its last list (${new Date(board.membersAsOf).toISOString().slice(0, 10)}).`] : []),
      ...(board.sectorsUnavailable ? [universe === "sectors" ? "The ASX company directory was unavailable, so the sectors are sized evenly." : "The ASX company directory was unavailable, so companies have no sector."] : []),
      ...(board.refreshError ? [`The refresh failed (${board.refreshError}); this is the board from ${new Date(board.builtAt).toISOString()}.`] : []),
    ];
    const errors = board.missingQuotes ? [`${board.missingQuotes} quotes were refused${board.rateLimited ? " (signed-out rate limit)" : ""}`] : [];
    const total = board.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);
    const common = { notes, ...(errors.length ? { errors, complete: false } : {}), freshness: { asOf: board.asOf } };
    if (universe === "sectors") {
      return {
        sections: [summary, {
          title: "Sectors",
          columns: [
            { key: "name", header: "Index" },
            { key: "last", header: "Last", align: "right" as const, format: num(level) },
            { key: "day", header: "1D", align: "right" as const, format: num((value) => pct(value)) },
            { key: "share", header: "Weight", align: "right" as const, format: num((value) => `${value.toFixed(1)}%`) },
          ],
          rows: [...board.assets].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity)).map((asset) => ({
            name: asset.name, symbol: asset.symbol, last: asset.price, day: asset.changePercent,
            share: total > 0 && asset.size != null ? asset.size / total * 100 : null,
          })),
        }],
        ...common,
      };
    }
    const movers = topMovers(board.assets, 5);
    return {
      sections: [
        summary,
        {
          title: "Sectors",
          columns: [
            { key: "sector", header: "Sector" },
            { key: "names", header: "Names", align: "right" as const },
            { key: "share", header: "Weight", align: "right" as const, format: num((value) => `${value.toFixed(1)}%`) },
            { key: "move", header: "Move", align: "right" as const, format: num((value) => pct(value)) },
            { key: "best", header: "Best" },
            { key: "worst", header: "Worst" },
          ],
          rows: summarizeSectors(board.assets).map((sector) => {
            const ranked = topMovers(sector.assets, 1);
            const tag = (asset: HeatmapAsset | undefined) => (asset ? `${asset.label} ${pct(asset.changePercent)}` : "—");
            return {
              sector: sector.sector ?? "Unclassified", names: sector.assets.length, share: total > 0 ? sector.size / total * 100 : null,
              move: sector.move, best: tag(ranked.gainers[0]), worst: tag(ranked.losers[0]),
            };
          }),
        },
        { title: "Gainers", columns: moverColumns, rows: moverRows(movers.gainers) },
        { title: "Losers", columns: moverColumns, rows: moverRows(movers.losers) },
      ],
      ...common,
    };
  },
} satisfies HeadlessPaneDefinition<"bundle">;
