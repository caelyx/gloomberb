import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartTableHeader,
  DataTableView,
  formatPercentAxis,
  PaneStatusBody,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  usePaneTabs,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type StatItem,
  type ChartTableChart,
} from "gloomberb/components";
import { useAssetData, useAsyncResource, useAutoRefresh, usePluginPaneState, usePluginTickerActions } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import { TICKER_RESEARCH_PANE_ID } from "gloomberb/types/config";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes } from "gloomberb/ui";
import { compareSortValues, isPlainKey, nextHeaderSort, type SortPreference } from "gloomberb/utils";
import { loadBoard, loadMovers, type BoardRow } from "./client";
import { paneSeries } from "../shared/series";
import { BENCHMARK, sinceCommonStart, YEAR_SESSIONS, type Mover, type Quadrant } from "./model";
import { capLabel, level, pct, toneColor } from "./format";

export const BOARD_PANE_ID = "asx-market";

type Tab = "market" | "movers";
const TABS: Array<{ label: string; value: Tab }> = [
  { label: "Market", value: "market" },
  { label: "Movers", value: "movers" },
];

type SectorColumn = DataTableColumn & { id: "label" | "price" | "day" | "week" | "month" | "ytd" | "year" | "rotation" };
type MoverColumnId = "code" | "name" | "price" | "changePercent" | "marketCap";
type MoverColumn = DataTableColumn & { id: MoverColumnId };

function sectorColumns(width: number): SectorColumn[] {
  const columns: SectorColumn[] = [
    { id: "label", label: "Sector", width: 22, align: "left", flexGrow: 1 },
    { id: "price", label: "Last", width: 9, align: "right" },
    { id: "day", label: "1D", width: 7, align: "right" },
    { id: "week", label: "1W", width: 7, align: "right" },
    { id: "month", label: "1M", width: 7, align: "right" },
    { id: "ytd", label: "YTD", width: 7, align: "right" },
    { id: "year", label: "1Y", width: 7, align: "right" },
    { id: "rotation", label: "Rotation", width: 10, align: "left" },
  ];
  const fixed = columns.slice(1).reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "label" ? { ...column, width: Math.max(14, width - fixed - 1) } : column));
}

function moverColumns(width: number): MoverColumn[] {
  const columns: MoverColumn[] = [
    { id: "code", label: "Code", width: 6, align: "left" },
    { id: "name", label: "Company", width: 20, align: "left", flexGrow: 1 },
    { id: "price", label: "Last", width: 9, align: "right" },
    { id: "changePercent", label: "Chg", width: 8, align: "right" },
    { id: "marketCap", label: "Mkt cap", width: 9, align: "right" },
  ];
  const fixed = columns.filter((column) => column.id !== "name").reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "name" ? { ...column, width: Math.max(12, width - fixed - 1) } : column));
}

const QUADRANT_COLOR: Record<Quadrant, string> = {
  Leading: colors.positive,
  Weakening: colors.warning,
  Lagging: colors.negative,
  Improving: colors.borderFocused,
};

/** ASXM: indices, the GICS sectors with returns and rotation, and the day's movers among the largest companies. */
export function BoardPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = usePluginPaneState<Tab>("tab", "market");
  const tabs = usePaneTabs({ tabs: TABS, activeValue: tab, onSelect: (value) => setTab(value as Tab), focused });
  const bodyHeight = Math.max(1, height - tabs.rows);
  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs.strip}
      {tab === "market"
        ? <MarketView focused={focused} width={width} height={bodyHeight} />
        : <MoversView focused={focused} width={width} height={bodyHeight} />}
    </Box>
  );
}

/**
 * The selected sector against the ASX 200 over the year, both from zero, so
 * the gap between the lines is the sector's relative return. The legend names
 * the sector, so the chart reads without the highlighted row.
 */
function sectorChart(sector: BoardRow, benchmark: BoardRow | undefined): ChartTableChart {
  // From the table's 1Y start (252 sessions), so the legend's figure is the 1Y column's.
  const [line, market] = sinceCommonStart(sector.history, benchmark?.history ?? [], YEAR_SESSIONS);
  const marketLabel = benchmark?.label.replace("S&P/", "") ?? "ASX 200";
  return {
    series: line.length ? [
      // Without the benchmark's history the sector is drawn alone, and its caption says what is missing.
      paneSeries(line, { id: sector.symbol, label: market.length ? sector.label : `${sector.label} (no ${marketLabel} history)`, color: colors.warning }),
      ...(market.length ? [paneSeries(market, { id: BENCHMARK, label: marketLabel, color: colors.textMuted })] : []),
    ] : [],
    formatValue: (value) => pct(value, 1),
    formatAxisValue: formatPercentAxis,
    empty: `No history for ${sector.label}`,
  };
}

function useRefreshKey(reload: () => void) {
  return useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);
}

function MarketView({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const assetData = useAssetData();
  const { pinTicker } = usePluginTickerActions();
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("sector", null);
  const loader = useCallback((force: boolean) => {
    if (!assetData) return Promise.reject(new Error("Market data is unavailable"));
    return loadBoard(assetData, { force });
  }, [assetData]);
  const { data, loading, error, updatedAt, reload } = useAsyncResource(loader);
  useAutoRefresh(updatedAt, reload);
  usePaneStatusFooter({ registrationId: `${BOARD_PANE_ID}:market`, loading: loading && !!data, error: data ? error : null });
  usePaneNoticeFooter({ registrationId: `${BOARD_PANE_ID}:notices`, focused, notices: data?.errors ?? [] });
  const handleKey = useRefreshKey(reload);

  const stats = useMemo<StatItem[]>(() => (data?.indices ?? []).map((row) => ({
    id: row.symbol,
    label: row.label.replace("S&P/ASX 200 VIX", "A-VIX").replace("S&P/", ""),
    value: level(row.price),
    detail: pct(row.changePercent),
    color: row.symbol === "^AXVI" ? undefined : toneColor(row.changePercent),
  })), [data]);

  const renderCell = useCallback((row: BoardRow, column: SectorColumn): DataTableCell => {
    switch (column.id) {
      case "label": return { text: row.label, color: colors.text };
      case "price": return { text: level(row.price), value: row.price, color: colors.textBright };
      case "day": return { text: pct(row.changePercent), value: row.changePercent, color: toneColor(row.changePercent) };
      case "week": return { text: pct(row.returns.week, 1), value: row.returns.week, color: toneColor(row.returns.week) };
      case "month": return { text: pct(row.returns.month, 1), value: row.returns.month, color: toneColor(row.returns.month) };
      case "ytd": return { text: pct(row.returns.ytd, 1), value: row.returns.ytd, color: toneColor(row.returns.ytd) };
      case "year": return { text: pct(row.returns.year, 1), value: row.returns.year, color: toneColor(row.returns.year) };
      case "rotation": return row.rotation
        ? { text: row.rotation.quadrant, color: QUADRANT_COLOR[row.rotation.quadrant], attributes: TextAttributes.BOLD }
        : { text: "—", color: colors.textMuted };
    }
  }, []);

  const selected = data?.sectors.find((row) => row.symbol === selectedId) ?? data?.sectors[0] ?? null;
  const chart = useMemo(() => (selected ? sectorChart(selected, data?.indices.find((row) => row.symbol === BENCHMARK)) : null), [data, selected]);

  if (!data) {
    return loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel="Loading ASX indices and sectors..." />
      : <PaneStatusBody error={error} errorTitle="ASX market unavailable." />;
  }
  const columns = sectorColumns(width);
  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<BoardRow, SectorColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={height}
        rootBefore={<ChartTableHeader width={width} height={height} tableRows={data.sectors.length} tableColumns={columns} figures={stats} chart={chart} />}
        selection={{ kind: "id", selectedId: selected?.symbol ?? null, getId: (row) => row.symbol, onChange: (id) => setSelectedId(id) }}
        onRootKeyDown={handleKey}
        columns={columns}
        items={data.sectors}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={(row) => row.symbol}
        onActivate={(row) => pinTicker(row.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID })}
        renderCell={renderCell}
        selectedTextOverridesCellColor
        emptyStateTitle="No sector indices loaded."
      />
    </Box>
  );
}

const DEFAULT_MOVER_SORT: SortPreference<MoverColumnId> = { columnId: "changePercent", direction: "desc" };

function MoversView({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const assetData = useAssetData();
  const { pinTicker } = usePluginTickerActions();
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("mover", null);
  const [sort, setSort] = useState<SortPreference<MoverColumnId>>(DEFAULT_MOVER_SORT);
  const loader = useCallback((force: boolean) => {
    if (!assetData) return Promise.reject(new Error("Market data is unavailable"));
    return loadMovers(assetData, { force, universe: 100 });
  }, [assetData]);
  const { data, loading, error, updatedAt, reload } = useAsyncResource(loader);
  useAutoRefresh(updatedAt, reload);
  usePaneStatusFooter({ registrationId: `${BOARD_PANE_ID}:movers`, loading: loading && !!data, error: data ? error : null });
  const handleKey = useRefreshKey(reload);

  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => (
    compareSortValues(a[sort.columnId ?? "changePercent"], b[sort.columnId ?? "changePercent"], sort.direction)
  )), [data, sort]);
  useEffect(() => {
    if (selectedId && rows.some((row) => row.code === selectedId)) return;
    setSelectedId(rows[0]?.code ?? null);
  }, [rows, selectedId, setSelectedId]);

  const renderCell = useCallback((row: Mover, column: MoverColumn): DataTableCell => {
    switch (column.id) {
      case "code": return { text: row.code, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "name": return { text: row.name, color: colors.text };
      case "price": return { text: row.price.toFixed(row.price < 1 ? 3 : 2), value: row.price };
      case "changePercent": return { text: pct(row.changePercent), value: row.changePercent, color: toneColor(row.changePercent) };
      case "marketCap": return { text: capLabel(row.marketCap), value: row.marketCap, color: colors.textDim };
    }
  }, []);

  if (!data) {
    return loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel="Loading the 100 largest ASX companies..." />
      : <PaneStatusBody error={error} errorTitle="ASX movers unavailable." />;
  }
  return (
    <DataTableView<Mover, MoverColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      selection={{ kind: "id", selectedId, getId: (row) => row.code, onChange: (id) => setSelectedId(id) }}
      onRootKeyDown={handleKey}
      columns={moverColumns(width)}
      items={rows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => nextHeaderSort(current, columnId as MoverColumnId, {
        firstDirection: (id) => (id === "code" || id === "name" ? "asc" : "desc"),
      }))}
      getItemKey={(row) => row.code}
      onActivate={(row) => pinTicker(`${row.code}.AX`, { floating: true, paneType: TICKER_RESEARCH_PANE_ID })}
      renderCell={renderCell}
      selectedTextOverridesCellColor
      emptyStateTitle="No quotes for the largest companies."
    />
  );
}
