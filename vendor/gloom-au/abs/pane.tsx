import { useCallback, useMemo } from "react";
import {
  ChartTableHeader,
  DataTableView,
  formatPercentAxis,
  PaneStatusBody,
  QueryBar,
  spanAxisFormatter,
  usePaneNoticeFooter,
  usePaneStatusLinkFooter,
  usePaneTabs,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type ChartTableChart,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { pointsInRange, STAT_RANGES, statRange, type StatRange } from "../shared/chart-range";
import { paneSeries } from "../shared/series";
import { useCacheStatus } from "../shared/cache-status";
import { combineMeta, type CacheMeta } from "../shared/disk-cache";
import { formatReleased } from "../shared/time";
import { cachedAbsIndicators, cachedAbsReleases, loadAbsIndicators, loadAbsReleases, type AbsIndicators } from "./client";
import { isHeadlineRelease, type AbsPoint, type AbsRelease } from "./model";
import { chartPoints, formatIndicator, formatIndicatorValue, formatPeriod, indicatorRows, type IndicatorRow } from "./view";

export const ABS_PANE_ID = "au-abs";

type Tab = "indicators" | "releases";
const TABS: Array<{ label: string; value: Tab }> = [
  { label: "Indicators", value: "indicators" },
  { label: "Releases", value: "releases" },
];

type IndicatorColumn = DataTableColumn & { id: "label" | "latest" | "period" | "previous" | "yearAgo" };
type ReleaseColumn = DataTableColumn & { id: "when" | "title" };

/** The label grows into the spare width; sized by hand it overran the table by a column and drew a scrollbar. */
const INDICATOR_COLUMNS: IndicatorColumn[] = [
  { id: "label", label: "Indicator", width: 18, align: "left", flexGrow: 1 },
  { id: "latest", label: "Latest", width: 8, align: "right" },
  { id: "period", label: "Period", width: 11, align: "left" },
  { id: "previous", label: "Previous", width: 9, align: "right" },
  { id: "yearAgo", label: "Year ago", width: 9, align: "right" },
];

const RELEASE_COLUMNS: ReleaseColumn[] = [
  { id: "when", label: "Sydney", width: 12, align: "left" },
  { id: "title", label: "Release", width: 20, align: "left", flexGrow: 1 },
];

/** Thousands of people, signed like the table: `+40k`, `-12.5k`. */
const formatThousandsAxis = spanAxisFormatter((value, digits) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}k`);

/** The selected indicator's history over the chosen range; the legend names the row. */
function indicatorChart(row: IndicatorRow, points: readonly AbsPoint[], range: StatRange): ChartTableChart {
  const shown = pointsInRange(chartPoints(points), range);
  const change = row.unit === "k";
  return {
    series: shown.length ? [paneSeries(shown, {
      id: `abs:${row.id}`,
      label: row.label,
      color: colors.warning,
      // A monthly change reads as bars either side of zero; levels and rates as a line.
      ...(change ? { style: "columns" as const, negativeColor: colors.negative } : {}),
    })] : [],
    formatValue: (value) => formatIndicatorValue(row.unit, value),
    formatAxisValue: change ? formatThousandsAxis : formatPercentAxis,
    empty: `No history for ${row.label}`,
  };
}

const PAGES: Record<Tab, string> = {
  indicators: "https://www.abs.gov.au/statistics/economy/key-indicators",
  releases: "https://www.abs.gov.au/release-calendar/future-releases",
};

interface AbsData {
  indicators: AbsIndicators;
  releases: AbsRelease[];
  errors: string[];
  meta: CacheMeta | null;
}

function cachedAbsData(): AbsData | null {
  const indicators = cachedAbsIndicators();
  if (!indicators) return null;
  const calendar = cachedAbsReleases();
  return {
    indicators,
    releases: calendar?.data ?? [],
    errors: [],
    meta: combineMeta([indicators.meta ? { label: "", meta: indicators.meta } : null, calendar ? { label: "Release calendar", meta: calendar } : null]),
  };
}

/** ABS: Australia's headline economic indicators and the ABS release calendar. */
export function AbsPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = usePluginPaneState<Tab>("tab", "indicators");
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [storedRange, setRange] = usePluginPaneState<StatRange>("range", "5Y");
  const range = statRange(storedRange);
  const loader = useCallback(async (force: boolean): Promise<AbsData> => {
    const [indicators, releases] = await Promise.all([
      loadAbsIndicators({ force }),
      loadAbsReleases({ force }).then(
        (result) => ({ value: result.data, meta: result as CacheMeta, error: null as string | null }),
        (error) => ({ value: [] as AbsRelease[], meta: null, error: `Release calendar unavailable: ${error instanceof Error ? error.message : String(error)}` }),
      ),
    ]);
    return {
      indicators,
      releases: releases.value,
      errors: [...indicators.errors, ...(releases.error ? [releases.error] : [])],
      meta: combineMeta([indicators.meta ? { label: "", meta: indicators.meta } : null, releases.meta ? { label: "Release calendar", meta: releases.meta } : null]),
    };
  }, []);
  // The last indicators on disk paint at once; the mount load refreshes them once stale.
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader, { initialData: cachedAbsData });
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(data?.meta, loading);
  const tabs = usePaneTabs({ tabs: TABS, activeValue: tab, onSelect: (value) => setTab(value as Tab), focused });

  usePaneStatusLinkFooter({ registrationId: ABS_PANE_ID, focused, url: PAGES[tab], loading: loading && !!data, error: data ? error : null, info: cacheStatus.info, stale: cacheStatus.stale });
  usePaneNoticeFooter({ registrationId: `${ABS_PANE_ID}:partial`, focused, notices: [...(data?.errors ?? []), ...cacheStatus.notices] });

  const rows = useMemo(() => (data ? indicatorRows(data.indicators) : []), [data]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const chart = useMemo(() => (selected && data
    ? indicatorChart(selected, data.indicators.series.get(selected.id) ?? [], range)
    : null), [data, range, selected]);
  const releases = useMemo(() => (data?.releases ?? []).filter((release) => release.at >= Date.now() - 6 * 60 * 60_000), [data]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const renderIndicator = useCallback((row: IndicatorRow, column: IndicatorColumn): DataTableCell => {
    switch (column.id) {
      case "label": return { text: row.label, color: colors.text };
      case "latest": return { text: formatIndicator(row.unit, row.latest), value: row.latest?.value ?? null, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "period": return { text: formatPeriod(row.latest?.period), value: row.latest?.period ?? null, color: colors.textMuted };
      case "previous": return { text: formatIndicator(row.unit, row.previous), value: row.previous?.value ?? null, color: colors.textDim };
      case "yearAgo": return { text: formatIndicator(row.unit, row.yearAgo), value: row.yearAgo?.value ?? null, color: colors.textDim };
    }
  }, []);

  const renderRelease = useCallback((row: AbsRelease, column: ReleaseColumn): DataTableCell => {
    const headline = isHeadlineRelease(row.title);
    return column.id === "when"
      ? { text: formatReleased(row.at), value: new Date(row.at), color: colors.textMuted }
      : { text: row.title, color: headline ? colors.textBright : colors.text, attributes: headline ? TextAttributes.BOLD : undefined };
  }, []);

  const bodyHeight = Math.max(1, height - tabs.rows);
  let body;
  if (!data) {
    body = loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel="Loading ABS statistics..." />
      : <PaneStatusBody error={error} errorTitle="ABS statistics unavailable." />;
  } else if (tab === "releases") {
    body = (
      <DataTableView<AbsRelease, ReleaseColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        selection={{ kind: "none" }}
        onRootKeyDown={handleKey}
        columns={RELEASE_COLUMNS}
        items={releases}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={(row) => `${row.at}|${row.title}`}
        renderCell={renderRelease}
        emptyStateTitle="No upcoming releases listed."
      />
    );
  } else {
    const columns = INDICATOR_COLUMNS;
    body = (
      <DataTableView<IndicatorRow, IndicatorColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        rootBefore={<ChartTableHeader width={width} height={bodyHeight} tableRows={rows.length} tableColumns={columns} chart={chart}
          query={<QueryBar width={width} view={{ value: range, options: STAT_RANGES, onChange: (value) => setRange(statRange(value)) }} />} />}
        selection={{ kind: "id", selectedId: selected?.id ?? null, getId: (row) => row.id, onChange: (id) => setSelectedId(id) }}
        onRootKeyDown={handleKey}
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={(row) => row.id}
        renderCell={renderIndicator}
        selectedTextOverridesCellColor
        emptyStateTitle="No ABS indicators loaded."
      />
    );
  }
  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs.strip}
      {body}
    </Box>
  );
}
