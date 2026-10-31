import type { HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { refreshNotice } from "../shared/cache-status";
import { sydneyToday } from "../shared/time";
import { formatRate } from "../rba/view";
import { loadRbap } from "./client";
import { moveOddsText, moveSteps } from "./model";
import { bpText, pathNotices, priceText, probabilityTable, probabilityText, rbapView, stepsText } from "./view";

const rate = (value: unknown) => formatRate(typeof value === "number" ? value : null);
const bp = (value: unknown) => bpText(typeof value === "number" ? value : null, 1);
const day = (row: { date: string; estimated: boolean }) => `${row.estimated ? "~" : ""}${row.date}`;

/** `gloomberb fn RBAP`: the RBA path priced by ASX 30-day interbank cash rate futures. `load` and `clock` (the Sydney date) are replaceable for tests. */
export function createRbapHeadless(load: typeof loadRbap = loadRbap, clock: () => string = sydneyToday) {
  return {
    discovery: {
      aliases: ["RBAP", "WIRA"],
      dataRequirements: ["ASX 30-day interbank cash rate futures (settlement prices)", "RBA table F1"],
      limitations: ["Conditional two-outcome probabilities in 25 bp steps", "Board dates from a maintained snapshot", "Look-backs only where the app has kept daily snapshots"],
    },
    shape: "bundle",
    argument: { kind: "none" },
    options: [],
    describe: "RBA rate path implied by ASX cash rate futures",
    // Settlement prices, once a business day: the path is as at the last settlement, not live quotes.
    freshness: { source: "ASX", status: "not-a-feed", basis: "daily settlement prices" },
    async load(_args, ctx) {
      const data = await load({ force: ctx.refresh, signal: ctx.signal });
      const today = clock();
      const view = rbapView(data, today);
      const next = view.meetings[0];
      const last = view.meetings.at(-1);
      const notes = [...pathNotices(view, today), ...refreshNotice(data.meta)];
      const probabilities = probabilityTable(view);
      return {
        sections: [
          { title: "Summary", entries: [
            { key: "settledOn", label: "Settlement prices of", value: view.settledOn, formatted: view.settledOn || "—" },
            { key: "target", label: "Cash rate target", value: view.target, formatted: formatRate(view.target) },
            { key: "cashRate", label: "Cash rate (overnight)", value: view.cashRate, formatted: view.cashRate == null ? "— (path starts from the front contract)" : `${formatRate(view.cashRate)} (${bpText(view.spread)} to target)` },
            { key: "next", label: "Next meeting", value: next ? moveSteps(next.move) : null, formatted: next ? `${day(next)}: ${moveOddsText(next.move)}, implied ${formatRate(next.rate)}` : "—" },
            { key: "end", label: "End of path", value: last?.cumulative ?? null, formatted: last ? `${day(last)}: ${formatRate(last.rate)} (${bpText(last.cumulative)}, ${stepsText(last.cumulative)} moves)` : "—" },
          ] },
          { title: "Path", columns: [
            { key: "meeting", header: "Meeting" },
            { key: "rate", header: "Implied target", align: "right", format: rate },
            { key: "move", header: "Priced move", align: "right", format: bp },
            { key: "odds", header: "P(move)", align: "right" },
            { key: "cumulative", header: "Priced since today", align: "right", format: bp },
            { key: "moves", header: "Moves priced", align: "right", format: (value) => stepsText(typeof value === "number" ? value : null) },
            { key: "method", header: "Method" },
            { key: "estimated", header: "Date", format: (value) => (value ? "estimated" : "published") },
          ], rows: view.meetings.map((row) => ({ ...row, meeting: day(row), odds: moveOddsText(row.move), moves: row.cumulative })) },
          ...(probabilities.levels.length ? [{ title: "Probabilities", columns: [
            { key: "meeting", header: "Meeting" },
            ...probabilities.levels.map((level, index) => ({ key: `p${index}`, header: formatRate(level), align: "right" as const,
              format: (value: unknown) => probabilityText(typeof value === "number" ? value : null) })),
          ], rows: probabilities.rows.map(({ meeting, odds }) => ({ meeting: day(meeting), ...Object.fromEntries(odds.map((value, index) => [`p${index}`, value])) })) }] : []),
          { title: "Contracts", columns: [
            { key: "label", header: "Month" },
            { key: "rate", header: "Implied cash rate", align: "right", format: rate },
            { key: "settlement", header: "Settlement", align: "right", format: (value) => priceText(value as number) },
            { key: "last", header: "Last", align: "right", format: (value) => priceText(value as number | null) },
            { key: "lastTradeOn", header: "Last trade", format: (value) => (typeof value === "string" ? value : "—") },
            { key: "bid", header: "Bid", align: "right", format: (value) => priceText(value as number | null) },
            { key: "ask", header: "Ask", align: "right", format: (value) => priceText(value as number | null) },
            { key: "volume", header: "Volume", align: "right" },
          ], rows: view.contracts.map((row) => ({ ...row })) },
          ...(view.ghosts.length ? [{ title: "Look-backs", columns: [
            { key: "label", header: "Look-back" }, { key: "settledOn", header: "Prices of" }, { key: "date", header: "Meeting" },
            { key: "rate", header: "Implied target", align: "right" as const, format: rate },
          ], rows: view.ghosts.flatMap((ghost) => ghost.points.map((point) => ({
            label: ghost.label, settledOn: ghost.settledOn, ...point, date: day(point),
          }))) }] : []),
        ],
        ...(data.errors.length ? { errors: data.errors, complete: false } : {}),
        ...(notes.length ? { notes } : {}),
        freshness: { asOf: view.settledOn || null },
        metadata: { settledOn: view.settledOn, spread: view.spread, units: "percent", probabilityBasis: "two-outcome, 25 bp steps" },
      };
    },
  } satisfies HeadlessPaneDefinition<"bundle">;
}

export const rbapHeadless = createRbapHeadless();
