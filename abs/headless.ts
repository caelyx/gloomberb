import type { HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { formatReleased } from "../shared/time";
import { refreshNotice } from "../shared/cache-status";
import { loadAbsIndicators, loadAbsReleases } from "./client";
import type { AbsSeriesDef } from "./model";
import { formatIndicator, formatPeriod, indicatorRows } from "./view";

const fmt = (unit: unknown) => (value: unknown) => (typeof value === "number" ? formatIndicator(unit as AbsSeriesDef["unit"], { value, period: "", date: "" }) : "—");

/** `gloomberb fn ABS`: headline indicators and upcoming ABS releases. */
export const absHeadless = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  describe: "ABS indicators",
  // ABS releases, monthly or quarterly.
  freshness: { source: "ABS", status: "not-a-feed", basis: "official releases" },
  async load(_args, ctx) {
    const [indicators, releases] = await Promise.all([
      loadAbsIndicators({ force: ctx.refresh, signal: ctx.signal }),
      loadAbsReleases({ force: ctx.refresh, signal: ctx.signal }).then((result) => result.data, () => null),
    ]);
    const rows = indicatorRows(indicators);
    return {
      sections: [
        {
          title: "Indicators",
          columns: [
            { key: "indicator", header: "Indicator" },
            { key: "latest", header: "Latest", align: "right", format: (value, row) => fmt(row.unit)(value) },
            { key: "period", header: "Period", format: (value) => formatPeriod(value as string | undefined) },
            { key: "previous", header: "Previous", align: "right", format: (value, row) => fmt(row.unit)(value) },
            { key: "yearAgo", header: "Year ago", align: "right", format: (value, row) => fmt(row.unit)(value) },
          ],
          rows: rows.map((row) => ({ indicator: row.label, id: row.id, unit: row.unit, latest: row.latest?.value ?? null, period: row.latest?.period, previous: row.previous?.value ?? null, yearAgo: row.yearAgo?.value ?? null })),
        },
        {
          title: "Upcoming releases",
          columns: [{ key: "when", header: "Sydney", format: (value) => formatReleased(Date.parse(String(value))) }, { key: "release", header: "Release" }],
          rows: (releases ?? []).filter((release) => release.at >= Date.now()).map((release) => ({ when: new Date(release.at).toISOString(), release: release.title })),
        },
      ],
      ...(indicators.errors.length || !releases ? { errors: [...indicators.errors, ...(releases ? [] : ["Release calendar unavailable"])], complete: false } : {}),
      ...(indicators.meta?.refreshError ? { notes: refreshNotice(indicators.meta) } : {}),
    };
  },
} satisfies HeadlessPaneDefinition<"bundle">;
