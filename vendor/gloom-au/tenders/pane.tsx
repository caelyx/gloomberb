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
import { useAutoRefresh, usePluginPaneState, usePluginTickerActions } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import { TICKER_RESEARCH_PANE_ID } from "gloomberb/types/config";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes } from "gloomberb/ui";
import { compareSortValues, isPlainKey, nextHeaderSort, type SortPreference } from "gloomberb/utils";
import { useCacheStatus, useKeyedCachedResource } from "../shared/cache-status";
import { formatReleased } from "../shared/time";
import { cachedContracts, loadContracts, type ContractList } from "./client";
import type { ContractWindow } from "./model";

export const TENDERS_PANE_ID = "au-contracts";

type Row = ContractList["contracts"][number];
type ColumnId = "publishedAt" | "agency" | "supplier" | "asxCode" | "value" | "description";
type Column = DataTableColumn & { id: ColumnId };

const WINDOWS: Array<{ value: ContractWindow; label: string }> = [
  { value: "1D", label: "1D" },
  { value: "3D", label: "3D" },
  { value: "7D", label: "7D" },
];

const DEFAULT_SORT: SortPreference<ColumnId> = { columnId: "value", direction: "desc" };

export function formatAud(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1e9) return `A$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `A$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `A$${(value / 1e3).toFixed(0)}K`;
  return `A$${value.toFixed(0)}`;
}

function columnsFor(width: number): Column[] {
  const fixed: Column[] = [
    { id: "publishedAt", label: "Published", width: 12, align: "left" },
    { id: "asxCode", label: "ASX", width: 5, align: "left" },
    { id: "value", label: "Value", width: 9, align: "right" },
  ];
  const used = fixed.reduce((total, column) => total + column.width + 1, 3) + 3;
  const flexible = Math.max(36, width - used);
  return [
    fixed[0]!,
    { id: "agency", label: "Agency", width: Math.floor(flexible * 0.28), align: "left" },
    { id: "supplier", label: "Supplier", width: Math.floor(flexible * 0.3), align: "left" },
    fixed[1]!,
    fixed[2]!,
    { id: "description", label: "Description", width: flexible - Math.floor(flexible * 0.28) - Math.floor(flexible * 0.3), align: "left", flexGrow: 1 },
  ];
}

/** AUTN: Commonwealth contracts published on AusTender, largest first, with ASX-listed suppliers marked. */
export function ContractsPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const [window, setWindow] = usePluginPaneState<ContractWindow>("window", "3D");
  const [asxOnly, setAsxOnly] = usePluginPaneState<boolean>("asxOnly", false);
  const [query, setQuery] = usePluginPaneState<string>("query", "");
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [sort, setSort] = useState<SortPreference<ColumnId>>(DEFAULT_SORT);
  const search = useQueryBarSearch();
  // A window on disk paints at once, also on switching window; the load refreshes it once stale.
  const { data, loading, error, updatedAt, load, reload } = useKeyedCachedResource(window, (key, force) => loadContracts(key, { force }), cachedContracts);
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(data?.meta, loading);

  usePaneStatusFooter({ registrationId: TENDERS_PANE_ID, loading: loading && !!data, error: data ? error : null, info: cacheStatus.info, stale: cacheStatus.stale });
  usePaneNoticeFooter({
    registrationId: `${TENDERS_PANE_ID}:partial`,
    focused,
    notices: [
      ...(data && !data.complete ? ["More contracts were published in this window than were loaded; the busiest days are cut short."] : []),
      ...cacheStatus.notices,
    ],
  });

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return (data?.contracts ?? [])
      .filter((row) => !asxOnly || row.asxCode)
      .filter((row) => !needle || `${row.agency} ${row.supplier} ${row.description} ${row.asxCode ?? ""} ${row.id}`.toUpperCase().includes(needle))
      .sort((a, b) => compareSortValues(a[sort.columnId ?? "value"], b[sort.columnId ?? "value"], sort.direction) || b.publishedAt - a.publishedAt);
  }, [asxOnly, data, query, sort]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId, setSelectedId]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const renderCell = useCallback((row: Row, column: Column): DataTableCell => {
    switch (column.id) {
      case "publishedAt": return { text: formatReleased(row.publishedAt), value: new Date(row.publishedAt), color: colors.textMuted };
      case "agency": return { text: row.agency, color: colors.textDim };
      case "supplier": return { text: row.supplier, color: row.asxCode ? colors.textBright : colors.text };
      case "asxCode": return { text: row.asxCode ?? "", color: colors.textBright, attributes: TextAttributes.BOLD };
      case "value": return { text: formatAud(row.value), value: row.value, color: colors.text };
      case "description": return { text: row.description, color: colors.text };
    }
  }, []);

  const queryBar = (
    <QueryBar
      width={width}
      search={{ ...search.searchProps, value: query, onChange: setQuery, placeholder: "Supplier, agency or keyword", focused }}
      filters={[{ id: "asx", kind: "toggle", label: "ASX-listed suppliers", short: "ASX", value: asxOnly, defaultValue: false, onChange: setAsxOnly }]}
      view={{ value: window, options: WINDOWS, onChange: (value) => setWindow(value as ContractWindow) }}
    />
  );

  if (!data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {queryBar}
        {loading || !error
          ? <PaneStatusBody loading align="center" loadingLabel="Loading AusTender contracts..." />
          : <PaneStatusBody error={error} errorTitle="AusTender contracts unavailable." />}
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
        selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: (id) => setSelectedId(id) }}
        onRootKeyDown={handleKey}
        columns={columnsFor(width)}
        items={rows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextHeaderSort(current, columnId as ColumnId, {
          firstDirection: (id) => (id === "value" || id === "publishedAt" ? "desc" : "asc"),
        }))}
        getItemKey={(row) => row.id}
        onActivate={(row) => { if (row.asxCode) pinTicker(`${row.asxCode}.AX`, { floating: true, paneType: TICKER_RESEARCH_PANE_ID }); }}
        renderCell={renderCell}
        selectedTextOverridesCellColor
        emptyStateTitle={asxOnly || query ? "No contracts match." : "No contracts published in this window."}
      />
    </Box>
  );
}
