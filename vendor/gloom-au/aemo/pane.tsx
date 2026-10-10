import { useCallback, useEffect, useMemo } from "react";
import {
  ChartTableHeader,
  DataTableView,
  PaneStatusBody,
  usePaneStatusLinkFooter,
  usePaneTabs,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePluginConfigState, usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes } from "gloomberb/ui";
import { isPlainKey, zonedDateTimeParts } from "gloomberb/utils";
import { loadNem, openElectricityKeyFrom, setOpenElectricityKey } from "./client";
import { OPEN_ELECTRICITY_KEY_SETTING } from "./openelectricity";
import { MIN_MAP_ROWS, priceBand } from "./map";
import { NEM_REGIONS, regionDay, type MarketNotice, type RegionDay, type RegionNow } from "./model";
import { bandColor, NemPriceMap, priceMapRows } from "./price-map";
import { FcasView, GenerationView, historyRange, mixRegion, MixHistoryView, type HistoryRange } from "./generation";

export const NEM_PANE_ID = "au-nem";

type Tab = "prices" | "generation" | "history" | "fcas" | "notices";
const TABS: Array<{ label: string; value: Tab }> = [
  { label: "Prices", value: "prices" },
  { label: "Generation", value: "generation" },
  { label: "Mix history", value: "history" },
  { label: "FCAS", value: "fcas" },
  { label: "Notices", value: "notices" },
];

interface Row extends RegionNow, RegionDay {}
type PriceColumn = DataTableColumn & { id: "region" | "price" | "average" | "low" | "high" | "negative" | "demand" };
type NoticeColumn = DataTableColumn & { id: "at" | "type" | "title" };

export function formatMwh(value: number | null): string {
  if (value == null) return "—";
  const digits = Math.abs(value) >= 100 && (value <= -100 || value >= 1000) ? 0 : 2;
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** NEM market time (AEST) as `21:55`. Brisbane keeps AEST all year, which is exactly NEM time. */
export function formatNemTime(ms: number): string {
  const parts = zonedDateTimeParts(ms, "Australia/Brisbane");
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** The map's band colour, except normal prices, which read as plain text in the table. */
function priceColor(value: number | null): string {
  if (value == null) return colors.textMuted;
  const band = priceBand(value);
  return band === "normal" ? colors.text : bandColor(band);
}

function priceColumns(width: number): PriceColumn[] {
  const columns: PriceColumn[] = [
    { id: "region", label: "Region", width: 16, align: "left", flexGrow: 1 },
    { id: "price", label: "$/MWh", width: 9, align: "right" },
    { id: "average", label: "24h avg", width: 9, align: "right" },
    { id: "low", label: "24h low", width: 9, align: "right" },
    { id: "high", label: "24h high", width: 9, align: "right" },
    { id: "negative", label: "≤$0", width: 5, align: "right" },
    { id: "demand", label: "Demand MW", width: 10, align: "right" },
  ];
  const fixed = columns.slice(1).reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "region" ? { ...column, width: Math.max(10, width - fixed - 1) } : column));
}

/** NEM: wholesale electricity prices and demand across the National Electricity Market, and AEMO market notices. */
export function NemPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = usePluginPaneState<Tab>("tab", "prices");
  const loader = useCallback((force: boolean) => loadNem({ force }), []);
  const { data, loading, error, updatedAt, reload } = useAsyncResource(loader);
  // Dispatch prices move every five minutes.
  useAutoRefresh(updatedAt, reload, { intervalMs: 5 * 60_000 });
  const [storedRegion, setRegion] = usePluginPaneState<string>("region", "NEM");
  const [storedRange, setRange] = usePluginPaneState<HistoryRange>("mixRange", "48H");
  // Optional: with an OpenElectricity key the mix gains rooftop solar and battery charging.
  const [storedKey] = usePluginConfigState<string>(OPEN_ELECTRICITY_KEY_SETTING, "");
  const oeKey = openElectricityKeyFrom(storedKey);
  // The chart series read the key outside React; keep them in step with a change in settings.
  useEffect(() => setOpenElectricityKey(oeKey), [oeKey]);
  const region = mixRegion(storedRegion);
  const range = historyRange(storedRange, !!oeKey);
  const tabs = usePaneTabs({ tabs: TABS, activeValue: tab, onSelect: (value) => setTab(value as Tab), focused });

  // The current interval, where the tab shows it: Generation names it in its query bar, and Mix history is an older window.
  const latestAt = tab === "generation" || tab === "history" ? null : data?.summary.regions[0]?.at ?? null;
  usePaneStatusLinkFooter({
    registrationId: NEM_PANE_ID,
    focused,
    url: "https://visualisations.aemo.com.au/aemo/apps/visualisation/index.html#/electricity/dashboard",
    loading: loading && !!data,
    error: data ? error : null,
    info: latestAt ? [{ id: "interval", parts: [{ text: "interval", tone: "label" }, { text: `${formatNemTime(latestAt)} AEST`, tone: "value" }] }] : [],
  });

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const now = Date.now();
    return data.summary.regions.map((region) => ({ ...region, ...regionDay(data.prices, region.region, now) }));
  }, [data]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const renderPrice = useCallback((row: Row, column: PriceColumn): DataTableCell => {
    switch (column.id) {
      case "region": return { text: NEM_REGIONS[row.region] ?? row.region, color: colors.text };
      case "price": return { text: formatMwh(row.price), value: row.price, color: priceColor(row.price), attributes: TextAttributes.BOLD };
      case "average": return { text: formatMwh(row.average), value: row.average, color: priceColor(row.average) };
      case "low": return { text: formatMwh(row.low), value: row.low, color: colors.textDim };
      case "high": return { text: formatMwh(row.high), value: row.high, color: colors.textDim };
      case "negative": return { text: row.negativeShare == null ? "—" : `${Math.round(row.negativeShare * 100)}%`, value: row.negativeShare == null ? null : row.negativeShare * 100, color: colors.textDim };
      case "demand": return { text: row.demand == null ? "—" : row.demand.toLocaleString("en-AU", { maximumFractionDigits: 0 }), value: row.demand, color: colors.textDim };
    }
  }, []);

  const renderNotice = useCallback((row: MarketNotice, column: NoticeColumn): DataTableCell => {
    switch (column.id) {
      case "at": return { text: formatNemTime(row.at), value: new Date(row.at), color: colors.textMuted };
      case "type": return { text: row.type.toLowerCase(), color: colors.textDim };
      case "title": return { text: row.title, color: colors.text };
    }
  }, []);

  const bodyHeight = Math.max(1, height - tabs.rows);
  let body;
  if (!data) {
    body = loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel="Loading NEM prices..." />
      : <PaneStatusBody error={error} errorTitle="NEM prices unavailable." />;
  } else if (tab === "generation") {
    body = <GenerationView focused={focused} width={width} height={bodyHeight} summary={data.summary} region={region} setRegion={setRegion} reloadPrices={reload} oeKey={oeKey} />;
  } else if (tab === "history") {
    body = <MixHistoryView focused={focused} width={width} height={bodyHeight} region={region} setRegion={setRegion} range={range} setRange={setRange} oeKey={oeKey} />;
  } else if (tab === "fcas") {
    body = <FcasView focused={focused} width={width} height={bodyHeight} summary={data.summary} reload={reload} />;
  } else if (tab === "notices") {
    body = (
      <DataTableView<MarketNotice, NoticeColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        selection={{ kind: "none" }}
        onRootKeyDown={handleKey}
        columns={[
          { id: "at", label: "AEST", width: 6, align: "left" },
          { id: "type", label: "Type", width: 24, align: "left" },
          { id: "title", label: "Notice", width: Math.max(20, width - 38), align: "left", flexGrow: 1 },
        ]}
        items={data.summary.notices}
        sortColumnId={null}
        sortDirection="desc"
        getItemKey={(row) => String(row.id)}
        renderCell={renderNotice}
        emptyStateTitle="No current market notices."
      />
    );
  } else {
    const columns = priceColumns(width);
    // The map has a natural height for the pane's width; the kit drops it
    // before the table loses rows, and there is no one-row stand-in for a map.
    const mapRows = priceMapRows(width);
    const chart = mapRows > 0 ? {
      render: (size: { width: number; height: number }) => <NemPriceMap regions={data.summary.regions} width={size.width} height={size.height} />,
      minRows: MIN_MAP_ROWS,
      maxRows: mapRows,
      strip: null,
    } : null;
    body = (
      <DataTableView<Row, PriceColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        rootBefore={<ChartTableHeader width={width} height={bodyHeight} tableRows={rows.length} tableColumns={columns} chart={chart} />}
        selection={{ kind: "none" }}
        onRootKeyDown={handleKey}
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={(row) => row.region}
        renderCell={renderPrice}
        emptyStateTitle="No NEM regions reported."
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
