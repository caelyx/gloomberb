import { useCallback, useMemo } from "react";
import {
  chartTableChromeRows,
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
  type StatItem,
  type ChartTableChart,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { cachedRbaTables, loadRbaTables } from "./client";
import type { Decision } from "./model";
import { useCacheStatus } from "../shared/cache-status";
import { pointsInRange, STAT_RANGES, statRange, type StatRange } from "../shared/chart-range";
import { paneSeries, type DatedPoint } from "../shared/series";
import { formatDay, sydneyToday } from "../shared/time";
import { boardView, formatChange, formatLevel, formatRate, rateRows, seriesPoints, type RateRow } from "./view";

export const RBA_PANE_ID = "au-rba";

type Tab = "rates" | "aud" | "board";
const TABS: Array<{ label: string; value: Tab }> = [
  { label: "Rates", value: "rates" },
  { label: "AUD", value: "aud" },
  { label: "Board", value: "board" },
];

const TABLE_PAGES: Record<Tab, string> = {
  rates: "https://www.rba.gov.au/statistics/tables/#interest-rates",
  aud: "https://www.rba.gov.au/statistics/tables/#exchange-rates",
  board: "https://www.rba.gov.au/monetary-policy/int-rate-decisions/",
};

type RateColumn = DataTableColumn & { id: "label" | "latest" | "asOf" | "week" | "month" | "year" };
type DecisionColumn = DataTableColumn & { id: "date" | "decision" | "rate" };

function rateColumns(tab: Tab, width: number): RateColumn[] {
  const unit = tab === "aud" ? "%" : "bp";
  const columns: RateColumn[] = [
    { id: "label", label: tab === "aud" ? "Rate" : "Series", width: 24, align: "left", flexGrow: 1 },
    { id: "latest", label: "Latest", width: 9, align: "right" },
    { id: "asOf", label: "As of", width: 11, align: "left" },
    { id: "week", label: `1W ${unit}`, width: 8, align: "right" },
    { id: "month", label: `1M ${unit}`, width: 8, align: "right" },
    { id: "year", label: `1Y ${unit}`, width: 8, align: "right" },
  ];
  const fixed = columns.slice(1).reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "label" ? { ...column, width: Math.max(16, width - fixed - 1) } : column));
}

const DECISION_COLUMNS: DecisionColumn[] = [
  { id: "date", label: "Decision", width: 11, align: "left" },
  { id: "decision", label: "Change", width: 10, align: "right" },
  { id: "rate", label: "Cash rate", width: 10, align: "right" },
];

/** Exchange rates and the TWI: as many decimals as the plotted range needs. */
const formatLevelAxis = spanAxisFormatter((value, digits) => value.toFixed(digits));

/** The selected series over the chosen range; the legend names the row and reads its latest level. */
function rateChart(row: RateRow, points: readonly DatedPoint[], range: StatRange): ChartTableChart {
  const shown = pointsInRange(points, range);
  return {
    series: shown.length ? [paneSeries(shown, {
      id: `rba:${row.id}`,
      label: row.label,
      color: colors.warning,
      // The target moves only on decision days, so it steps rather than slopes.
      ...(row.id === "FIRMMCRTD" ? { style: "step" as const } : {}),
    })] : [],
    formatValue: (value) => formatLevel({ kind: row.kind, latest: value }),
    formatAxisValue: row.kind === "rate" ? formatPercentAxis : formatLevelAxis,
    empty: `No history for ${row.label}`,
  };
}

function changeColor(value: number | null): string {
  if (value == null || value === 0) return colors.textDim;
  return value > 0 ? colors.positive : colors.negative;
}

/** RBA: the cash rate, money-market rates, government bond yields, the AUD and the board calendar. */
export function RbaPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = usePluginPaneState<Tab>("tab", "rates");
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [storedRange, setRange] = usePluginPaneState<StatRange>("range", "5Y");
  const range = statRange(storedRange);
  const loader = useCallback((force: boolean) => loadRbaTables({ force }), []);
  // The last tables on disk paint at once; the mount load refreshes them once stale.
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader, { initialData: cachedRbaTables });
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(data?.meta, loading);
  const tabs = usePaneTabs({ tabs: TABS, activeValue: tab, onSelect: (value) => setTab(value as Tab), focused });

  usePaneStatusLinkFooter({
    registrationId: RBA_PANE_ID,
    focused,
    url: TABLE_PAGES[tab],
    loading: loading && !!data,
    error: data ? error : null,
    info: cacheStatus.info,
    stale: cacheStatus.stale,
  });
  usePaneNoticeFooter({
    registrationId: `${RBA_PANE_ID}:partial`,
    focused,
    notices: [...(data?.errors ?? []), ...cacheStatus.notices],
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return rateRows(data.tables, tab === "aud" ? ["AUD"] : ["Policy", "Money market", "Government bonds"]);
  }, [data, tab]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const chart = useMemo(() => (selected && data ? rateChart(selected, seriesPoints(data.tables, selected.id), range) : null), [data, range, selected]);
  const board = useMemo(() => (data ? boardView(data.tables, sydneyToday()) : null), [data]);
  // The Board tab charts the cash rate target over the same range as the other tabs.
  const boardChart = useMemo(() => {
    if (!data || tab !== "board") return null;
    const target = rateRows(data.tables, ["Policy"]).find((row) => row.id === "FIRMMCRTD");
    return target ? rateChart(target, seriesPoints(data.tables, target.id), range) : null;
  }, [data, range, tab]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const renderRate = useCallback((row: RateRow, column: RateColumn): DataTableCell => {
    switch (column.id) {
      case "label": return { text: row.label, color: row.id === "FIRMMCRTD" ? colors.textBright : colors.text, attributes: row.id === "FIRMMCRTD" ? TextAttributes.BOLD : undefined };
      case "latest": return { text: formatLevel(row), value: row.latest, color: colors.textBright };
      case "asOf": return { text: formatDay(row.asOf), value: row.asOf, color: colors.textMuted };
      case "week": return { text: formatChange(row, row.week), value: row.week, color: changeColor(row.week) };
      case "month": return { text: formatChange(row, row.month), value: row.month, color: changeColor(row.month) };
      case "year": return { text: formatChange(row, row.year), value: row.year, color: changeColor(row.year) };
    }
  }, []);

  const renderDecision = useCallback((row: Decision, column: DecisionColumn): DataTableCell => {
    switch (column.id) {
      case "date": return { text: formatDay(row.date), value: row.date, color: row.change == null && row.rate == null ? colors.textMuted : colors.text };
      case "decision": {
        if (row.change == null) return { text: row.rate == null ? "upcoming" : "", value: null, color: colors.textMuted };
        const bp = Math.round(row.change * 100);
        return { text: bp === 0 ? "hold" : `${bp > 0 ? "+" : ""}${bp} bp`, value: bp, color: changeColor(row.change) };
      }
      case "rate": return { text: row.rate == null ? "" : formatRate(row.rate), value: row.rate };
    }
  }, []);

  const bodyHeight = Math.max(1, height - tabs.rows);
  let body;
  if (!data) {
    body = loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel="Loading RBA statistics..." />
      : <PaneStatusBody error={error} errorTitle="RBA statistics unavailable." />;
  } else if (tab === "board" && board) {
    // Priority order: a short pane drops figures from the end, and the chart already reads the target.
    const stats: StatItem[] = [
      { id: "next", label: "Next decision", value: formatDay(board.next), detail: board.daysToNext == null ? undefined : `in ${board.daysToNext} days, 2:30 pm Sydney` },
      { id: "target", label: "Cash rate target", value: formatRate(board.target), detail: board.targetAsOf ? formatDay(board.targetAsOf) : undefined },
      {
        id: "last",
        label: "Last change",
        value: board.lastChange?.change == null ? "—" : `${board.lastChange.change > 0 ? "+" : ""}${Math.round(board.lastChange.change * 100)} bp`,
        detail: board.lastChange?.date ? formatDay(board.lastChange.date) : undefined,
        color: changeColor(board.lastChange?.change ?? null),
      },
    ];
    body = (
      <DataTableView<Decision, DecisionColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        rootBefore={<ChartTableHeader width={width} height={bodyHeight} figures={stats} tableRows={board.meetings.length}
          tableChromeRows={chartTableChromeRows(DECISION_COLUMNS, width)} chart={boardChart}
          query={<QueryBar width={width} view={{ value: range, options: STAT_RANGES, onChange: (value) => setRange(statRange(value)) }} />} />}
        selection={{ kind: "none" }}
        onRootKeyDown={handleKey}
        columns={DECISION_COLUMNS}
        items={board.meetings}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={(row) => row.date}
        renderCell={renderDecision}
        emptyStateTitle="No board meetings listed."
      />
    );
  } else {
    const columns = rateColumns(tab, width);
    body = (
      <DataTableView<RateRow, RateColumn>
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
        renderCell={renderRate}
        selectedTextOverridesCellColor
        emptyStateTitle="No RBA series loaded."
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
