import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePaneTickerIdentity, usePluginPaneState, usePluginTickerActions } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import { TICKER_RESEARCH_PANE_ID } from "gloomberb/types/config";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes } from "gloomberb/ui";
import { compareSortValues, isPlainKey, nextHeaderSort, type SortPreference } from "gloomberb/utils";
import { asxCodeForTicker } from "../shared/asx";
import { useCacheStatus } from "../shared/cache-status";
import { cachedLatestShorts, loadLatestShorts } from "./client";
import { productName, weekChange } from "./model";
import { formatCount, formatPercent, formatPoints, pointsColor } from "./format";
import { CompanyShorts } from "./tab";
import { formatDay } from "../shared/time";

export const SHORTS_PANE_ID = "asx-short-positions";
export const SHORTS_TAB_ID = "asx-short-positions";

interface Row {
  code: string;
  name: string;
  percent: number;
  weekChange: number | null;
  /** Not on the report a week earlier, so there is no change to show. */
  isNew: boolean;
  shortPositions: number;
  onIssue: number;
}

type ColumnId = "code" | "name" | "percent" | "weekChange" | "shortPositions" | "onIssue";
type Column = DataTableColumn & { id: ColumnId };

const ALL_COLUMNS: Column[] = [
  { id: "code", label: "Code", width: 6, align: "left" },
  { id: "name", label: "Company", width: 18, align: "left", flexGrow: 1 },
  { id: "percent", label: "Short %", width: 8, align: "right" },
  { id: "weekChange", label: "1W pp", width: 7, align: "right" },
  { id: "shortPositions", label: "Short", width: 9, align: "right" },
  { id: "onIssue", label: "On issue", width: 9, align: "right" },
];

function columnsFor(width: number): Column[] {
  const fixed = ALL_COLUMNS.filter((column) => column.id !== "name").reduce((total, column) => total + column.width + 1, 3);
  const columns = width - fixed < 18 ? ALL_COLUMNS.filter((column) => column.id !== "onIssue") : ALL_COLUMNS;
  const used = columns.filter((column) => column.id !== "name").reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "name" ? { ...column, width: Math.max(12, width - used - 1) } : column));
}

const DEFAULT_SORT: SortPreference<ColumnId> = { columnId: "percent", direction: "desc" };

/** ASXS: every ASX product ASIC has reported short positions in, most shorted first; `ASXS <ticker>` for one history. */
export function ShortPositionsPane({ paneId, focused, width, height }: PaneProps) {
  const { symbol, ticker } = usePaneTickerIdentity(paneId);
  const code = asxCodeForTicker(ticker, symbol);
  return code
    ? <CompanyShorts key={code} code={code} focused={focused} width={width} height={height} />
    : <MarketShorts focused={focused} width={width} height={height} />;
}

function MarketShorts({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const { pinTicker } = usePluginTickerActions();
  const loader = useCallback((force: boolean) => loadLatestShorts({ force }), []);
  // The last report on disk paints at once; the mount load checks ASIC for a newer one.
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader, { initialData: cachedLatestShorts });
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(data?.meta, loading);
  const [sort, setSort] = useState<SortPreference<ColumnId>>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedCode", null);
  const [query, setQuery] = usePluginPaneState<string>("query", "");
  const search = useQueryBarSearch();

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const before = data.weekAgo ? new Map(data.weekAgo.rows.map((row) => [row.code, row.percent])) : null;
    const needle = query.trim().toUpperCase();
    return data.latest.rows
      .filter((row) => !needle || row.code.startsWith(needle) || row.product.toUpperCase().includes(needle))
      .map((row) => {
        const change = weekChange(row.percent, before, row.code);
        return {
          code: row.code,
          name: data.names.get(row.code) ?? productName(row.product),
          percent: row.percent,
          weekChange: typeof change === "number" ? change : null,
          isNew: change === "new",
          shortPositions: row.shortPositions,
          onIssue: row.onIssue,
        };
      })
      .sort((a, b) => compareSortValues(a[sort.columnId ?? "percent"], b[sort.columnId ?? "percent"], sort.direction)
        || b.percent - a.percent);
  }, [data, query, sort]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.code === selectedId)) return;
    setSelectedId(rows[0]?.code ?? null);
  }, [rows, selectedId, setSelectedId]);

  usePaneStatusFooter({
    registrationId: SHORTS_PANE_ID,
    loading: loading && !!data,
    error: data ? error : null,
    info: data ? [{ id: "asof", parts: [{ text: "as at", tone: "label" }, { text: formatDay(data.latest.date), tone: "value" }] }, ...cacheStatus.info] : [],
    stale: cacheStatus.stale,
  });
  usePaneNoticeFooter({ registrationId: `${SHORTS_PANE_ID}:notices`, focused, notices: cacheStatus.notices });

  const openTicker = useCallback((row: Row) => {
    pinTicker(`${row.code}.AX`, { floating: true, paneType: TICKER_RESEARCH_PANE_ID, tabId: SHORTS_TAB_ID });
  }, [pinTicker]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const columns = useMemo(() => columnsFor(width), [width]);
  const renderCell = useCallback((row: Row, column: Column): DataTableCell => {
    switch (column.id) {
      case "code": return { text: row.code, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "name": return { text: row.name, color: colors.text };
      case "percent": return { text: formatPercent(row.percent), value: row.percent, color: row.percent >= 10 ? colors.warning : colors.text };
      case "weekChange": return row.isNew
        ? { text: "new", color: colors.textMuted }
        : { text: formatPoints(row.weekChange), value: row.weekChange, color: pointsColor(row.weekChange) };
      case "shortPositions": return { text: formatCount(row.shortPositions), value: row.shortPositions, color: colors.textDim };
      case "onIssue": return { text: formatCount(row.onIssue), value: row.onIssue, color: colors.textMuted };
    }
  }, []);

  const queryBar = (
    <QueryBar
      width={width}
      search={{ ...search.searchProps, value: query, onChange: setQuery, placeholder: "Code or company", focused }}
    />
  );

  if (!data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {loading || !error
          ? <PaneStatusBody loading align="center" loadingLabel="Loading ASIC short positions..." />
          : <PaneStatusBody error={error} errorTitle="ASIC short positions unavailable." />}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {queryBar}
      <DataTableView<Row, Column>
        focused={focused && !search.searchProps.active}
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        selection={{ kind: "id", selectedId, getId: (row) => row.code, onChange: (id) => setSelectedId(id) }}
        onRootKeyDown={handleKey}
        columns={columns}
        items={rows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextHeaderSort(current, columnId as ColumnId, {
          firstDirection: (id) => (id === "code" || id === "name" ? "asc" : "desc"),
        }))}
        getItemKey={(row) => row.code}
        onActivate={openTicker}
        renderCell={renderCell}
        selectedTextOverridesCellColor
        emptyStateTitle={query ? "No reported shorts match." : "No short positions reported."}
      />
    </Box>
  );
}
