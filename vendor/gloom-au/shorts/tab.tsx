import { useCallback, useMemo } from "react";
import {
  ChartTableHeader,
  DataTableView,
  EmptyState,
  formatPercentAxis,
  PaneStatusBody,
  QueryBar,
  useChartTableSelection,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  type DataTableCell,
  type DataTableColumn,
  type StatItem,
} from "gloomberb/components";
import { useAutoRefresh, usePaneTickerIdentity, usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { TickerResearchTabProps } from "gloomberb/types/plugin";
import { Box } from "gloomberb/ui";
import { asxCodeForTicker } from "../shared/asx";
import { useCacheStatus, useKeyedCachedResource } from "../shared/cache-status";
import { paneSeries } from "../shared/series";
import { cachedShortHistory, loadShortHistory } from "./client";
import { changePoints, defaultHistoryRow, historyFor, reportedSeries, type ShortHistoryPoint, type ShortWindow } from "./model";
import { formatCount, formatPercent, formatPoints, pointsColor } from "./format";
import { formatDay } from "../shared/time";

type Column = DataTableColumn & { id: "date" | "percent" | "change" | "short" };
const COLUMNS: Column[] = [
  { id: "date", label: "As at", width: 11, align: "left" },
  { id: "percent", label: "Short %", width: 8, align: "right" },
  { id: "change", label: "Chg pp", width: 7, align: "right" },
  { id: "short", label: "Short", width: 10, align: "right" },
];

const WINDOWS: Array<{ value: ShortWindow; label: string }> = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y weekly" },
];

interface Row extends ShortHistoryPoint {
  change: number | null;
}

/** A day the code was missing from has no point on the chart; Left and Right skip it. */
const rowDate = (row: Row) => (row.percent == null ? null : new Date(`${row.date}T00:00:00Z`));

/** Figures for the newest point and its changes over the window. */
export function shortStats(points: readonly ShortHistoryPoint[]): StatItem[] {
  const latest = points.find((point) => point.percent != null);
  const at = (days: number) => {
    if (!latest) return null;
    const cutoff = Date.parse(`${latest.date}T00:00:00Z`) - days * 86_400_000;
    return points.find((point) => point.percent != null && Date.parse(`${point.date}T00:00:00Z`) <= cutoff) ?? null;
  };
  const week = at(7);
  const month = at(28);
  const known = points.map((point) => point.percent).filter((value): value is number => value != null);
  return [
    { id: "short", label: "Short", value: formatPercent(latest?.percent), detail: latest ? `as at ${formatDay(latest.date)}` : undefined, tone: (latest?.percent ?? 0) >= 10 ? "warning" : undefined },
    { id: "week", label: "1W change", value: formatPoints(changePoints(latest?.percent, week?.percent)), detail: "pp" },
    { id: "month", label: "1M change", value: formatPoints(changePoints(latest?.percent, month?.percent)), detail: "pp" },
    { id: "range", label: "Range", value: known.length ? `${formatPercent(Math.min(...known))} – ${formatPercent(Math.max(...known))}` : "—" },
    { id: "positions", label: "Positions", value: formatCount(latest?.shortPositions) },
  ];
}

/** Ticker Research → Short positions, for ASX listings. */
export function ShortPositionsTab({ width, height, focused }: TickerResearchTabProps) {
  const { symbol, ticker } = usePaneTickerIdentity();
  const code = asxCodeForTicker(ticker, symbol);
  if (!code) return <EmptyState title="Short positions are for ASX listings." />;
  return <CompanyShorts key={code} code={code} width={width} height={height} focused={focused} />;
}

/** One company's short position history: the Ticker Research tab, and `ASXS <ticker>`. */
export function CompanyShorts({ code, width, height, focused }: Pick<TickerResearchTabProps, "width" | "height" | "focused"> & { code: string }) {
  const [window, setWindow] = usePluginPaneState<ShortWindow>("shortsWindow", "1M");
  // A window whose days are all on disk paints at once, also on switching window.
  const { data, loading, error, updatedAt, load, reload } = useKeyedCachedResource(window, (key, force) => loadShortHistory(key, { force }), cachedShortHistory);
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(data?.meta, loading);
  usePaneStatusFooter({ registrationId: "au-shorts-tab", loading: loading && !!data, error: data ? error : null, info: data ? cacheStatus.info : [], stale: cacheStatus.stale });
  usePaneNoticeFooter({ registrationId: "au-shorts-tab:notices", focused, notices: cacheStatus.notices });

  const points = useMemo(() => (data ? historyFor(data.days, code) : []), [code, data]);
  const reported = points.some((point) => point.percent != null);
  const rows = useMemo<Row[]>(() => points.map((point, index) => ({
    ...point,
    change: changePoints(point.percent, points[index + 1]?.percent),
  })), [points]);
  const stats = useMemo(() => shortStats(points), [points]);
  // The legend names the series as the table's Short % column does.
  const series = useMemo(() => [paneSeries(reportedSeries(points), { id: `asic-short:${code}`, label: "Short %", color: colors.warning })], [code, points]);
  const [selectedDate, setSelectedDate] = usePluginPaneState<string | null>("shortsSelected", null);
  const selected = defaultHistoryRow(rows, selectedDate);
  const link = useChartTableSelection({
    rows, getId: (row) => row.date, getDate: rowDate, selectedId: selected?.date ?? null, onSelect: setSelectedDate, focused,
  });

  const renderCell = useCallback((row: Row, column: Column): DataTableCell => {
    switch (column.id) {
      case "date": return { text: formatDay(row.date), value: row.date, color: colors.textMuted };
      case "percent": return { text: row.percent == null ? "not reported" : formatPercent(row.percent), value: row.percent, color: row.percent == null ? colors.textMuted : colors.text };
      case "change": return { text: row.change == null ? "" : formatPoints(row.change), value: row.change, color: pointsColor(row.change) };
      case "short": return { text: row.shortPositions == null ? "" : formatCount(row.shortPositions), value: row.shortPositions, color: colors.textDim };
    }
  }, []);

  const queryBar = (
    <QueryBar width={width} view={{ value: window, options: WINDOWS, onChange: (value) => setWindow(value as ShortWindow) }} />
  );

  if (!data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {queryBar}
        {loading || !error
          ? <PaneStatusBody loading align="center" loadingLabel="Loading ASIC short position reports..." />
          : <PaneStatusBody error={error} errorTitle="ASIC short positions unavailable." />}
      </Box>
    );
  }
  if (!reported) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {queryBar}
        <EmptyState title={`No short positions reported in ${code}.`} hint="ASIC lists only products with reported short positions." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<Row, Column>
        focused={focused}
        rootWidth={width}
        rootHeight={height}
        rootBefore={<ChartTableHeader width={width} height={height} tableRows={rows.length} tableColumns={COLUMNS} query={queryBar} figures={stats}
          chart={{ series, formatValue: formatPercent, formatAxisValue: formatPercentAxis, ...link }} />}
        selection={{ kind: "id", selectedId: selected?.date ?? null, getId: (row) => row.date, onChange: setSelectedDate }}
        columns={COLUMNS}
        items={rows}
        sortColumnId={null}
        sortDirection="desc"
        getItemKey={(row) => row.date}
        renderCell={renderCell}
        emptyStateTitle="No reports in this window."
      />
    </Box>
  );
}
