import { useCallback, useMemo } from "react";
import {
  ChartTableHeader,
  DataTableView,
  PaneStatusBody,
  QueryBar,
  RatioBar,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  type ChartTableChart,
  type PaneFooterSegment,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type QueryBarSelectFilter,
  type StatItem,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { ResolvedSeries } from "gloomberb/time-series";
import { Box, Span, Text, TextAttributes, useUiCapabilities } from "gloomberb/ui";
import { isPlainKey, zonedDateTimeParts } from "gloomberb/utils";
import { CACHE_POLICY } from "../shared/cache-policy";
import { useCacheStatus } from "../shared/cache-status";
import { intervalSeries } from "../shared/series";
import {
  cachedFuelHistory,
  cachedOpenElectricityHistory,
  cachedOpenElectricityRecent,
  loadFuelCurrent,
  loadFuelHistory,
  loadNemHistory,
  loadOpenElectricityHistory,
  loadOpenElectricityRecent,
} from "./client";
import {
  apportionCells,
  batteryResponse,
  fuelMix,
  hourlyPrices,
  mixHistory,
  mixRegionName,
  NEM_TOTAL,
  renewableShare,
  REPORT_HOURS,
  summariseHistory,
  withFuelRows,
  type FuelMix,
  type FuelReport,
  type FuelSpec,
  type FuelWindowSummary,
  type MixPoint,
} from "./fuel";
import { fuelColor, priceLineColor } from "./fuel-colors";
import { FCAS_SERVICES, NEM_REGIONS, type NemSummary, type RegionFcas } from "./model";
import {
  batteryArbitrage,
  batteryNet,
  currentRows,
  historyRows,
  oeSeries,
  openElectricityErrorText,
  openElectricityLag,
  OPEN_ELECTRICITY_HINT,
  priceWeighted,
  type OeData,
} from "./openelectricity";
import type { Cached } from "../shared/disk-cache";

const PANE_ID = "au-nem";
const HOUR = 3_600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** AEMO's windows, and with an OpenElectricity key the last 24 hours of batteries at 5 minutes. */
export type HistoryRange = Exclude<FuelReport, "CURRENT"> | "24H";

export const HISTORY_RANGES: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: "24H", label: "24h" },
  { value: "48H", label: "48h" },
  { value: "3M", label: "3M" },
  { value: "12M", label: "12M" },
];

function rangeOptions(withKey: boolean) {
  return HISTORY_RANGES.filter((option) => withKey || option.value !== "24H");
}

export function historyRange(value: unknown, withKey = false): HistoryRange {
  return rangeOptions(withKey).some((option) => option.value === value) ? (value as HistoryRange) : "48H";
}

/** What AEMO's mix leaves out, and how to fill it. */
export const AEMO_MIX_LIMITS = `AEMO reports utility solar only (no rooftop PV) and battery discharge only (no charging). ${OPEN_ELECTRICITY_HINT}`;

/** Footer credit wherever OpenElectricity's figures show (CC BY 4.0 asks for attribution). */
const OE_CREDIT: PaneFooterSegment = { id: "oe", parts: [{ text: "rooftop, charging", tone: "label" }, { text: "OpenElectricity", tone: "value" }] };

/**
 * Without a key: a quiet note of what the mix leaves out, not a warning. It
 * is a standing limit of the source, not a failure (docs/nem.md explains it
 * and how to add a key).
 */
const AEMO_ONLY: PaneFooterSegment = { id: "aemo-only", parts: [{ text: "no rooftop PV or charging", tone: "muted" }], title: AEMO_MIX_LIMITS };

/**
 * The notice for OpenElectricity's part of a view, with a key: a failure, a
 * copy kept after a failed refresh (with its age, since it is merged into
 * AEMO's newer figures), or an answer with nothing for the view.
 */
export function openElectricityNotices(state: { error: string | null; data: Cached<OeData> | null | undefined }, rows: number): string[] {
  if (state.error) return [openElectricityErrorText(state.error)];
  const data = state.data;
  if (!data) return [];
  if (data.refreshError) return [`Rooftop solar and battery charging are from ${formatNemStamp(data.fetchedAt, true)} AEST (refresh failed): ${data.refreshError}`];
  return rows === 0 ? ["OpenElectricity returned no rooftop solar or battery data for this window."] : [];
}

/**
 * One OpenElectricity resource for a view: none without a key; refreshed on
 * its cache's freshness, not forced, since each request costs credits. A new
 * window starts empty rather than reading the last window's rows on its times.
 */
function useOpenElectricity<T>(loader: (() => Promise<T>) | null, initial: () => T | null, intervalMs: number) {
  const resource = useAsyncResource(loader, { initialData: initial });
  const { load } = resource;
  useAutoRefresh(resource.updatedAt, useCallback(() => void load(), [load]), { intervalMs });
  return resource;
}

export function mixRegion(value: unknown): string {
  return value === NEM_TOTAL || (typeof value === "string" && value in NEM_REGIONS) ? (value as string) : NEM_TOTAL;
}

/** `NSW` for `NSW1`. */
export function regionCode(region: string): string {
  return region.replace(/1$/, "");
}

function regionFilter(region: string, onChange: (value: string) => void): QueryBarSelectFilter {
  return {
    id: "region",
    label: "Region",
    value: region,
    options: [
      { value: NEM_TOTAL, label: "NEM (all regions)", short: "NEM" },
      ...Object.entries(NEM_REGIONS).map(([id, name]) => ({ value: id, label: name, short: regionCode(id) })),
    ],
    onChange,
  };
}

export function formatMw(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function formatShare(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%`;
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** `9 Oct 18:00` (hourly) or `9 Oct` (daily, weekly), NEM time. */
export function formatNemStamp(ms: number, withTime: boolean): string {
  const parts = zonedDateTimeParts(ms, "Australia/Brisbane");
  const day = `${parts.day} ${MONTHS[parts.month - 1]}`;
  return withTime ? `${day} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` : day;
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

/** A share column: the percentage, with a bar in the fuel's colour where the column has room. */
function shareCell(share: number | null, color: string, width: number, selected: boolean, terminal: boolean): DataTableCell {
  const text = formatShare(share);
  const barCells = width - 5;
  if (share == null || barCells < 3) return { text, value: share == null ? null : share * 100, color: colors.text };
  return {
    text,
    value: share * 100,
    content: (
      <Box flexDirection="row" height={1} width={width} overflow="hidden" alignItems="center">
        <RatioBar ratio={share} width={barCells} color={selected ? colors.selectedText : color} resolution={terminal ? "eighth" : "half"} track />
        <Box flexGrow={1} justifyContent="flex-end"><Text fg={selected ? colors.selectedText : colors.text}>{text}</Text></Box>
      </Box>
    ),
  };
}

// --- Generation: the latest dispatch interval ------------------------------------

/** One stacked bar per mix, each fuel's segment in its colour, the region's code before it. */
function MixBars({ mixes, width }: { mixes: readonly FuelMix[]; width: number }) {
  const desktop = useUiCapabilities().nativePaneChrome === true;
  const labelWidth = 4;
  const barWidth = Math.max(1, width - 2 - labelWidth);
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {mixes.map((mix) => {
        const parts = mix.fuels.filter((entry) => entry.mw > 0);
        const cells = apportionCells(parts.map((entry) => entry.mw), barWidth);
        return (
          <Box key={mix.region} flexDirection="row" height={1}>
            <Box width={labelWidth} flexShrink={0}><Text fg={colors.textDim} attributes={TextAttributes.BOLD}>{regionCode(mix.region)}</Text></Box>
            {desktop ? (
              <Box flexDirection="row" alignItems="center" width={barWidth} style={{ height: "9px", borderRadius: "2px", overflow: "hidden" }}>
                {parts.map((entry) => (
                  <Box key={entry.fuel.id} backgroundColor={fuelColor(entry.fuel.id)} style={{ width: `${(entry.share * 100).toFixed(2)}%`, height: "100%", minWidth: "2px" }} />
                ))}
              </Box>
            ) : (
              <Text>
                {parts.flatMap((entry, index) => (cells[index] ? [<Span key={entry.fuel.id} fg={fuelColor(entry.fuel.id)}>{"█".repeat(cells[index]!)}</Span>] : []))}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

interface GenerationRow {
  fuel: FuelSpec;
  mw: number | null;
  share: number | null;
  nemMw: number | null;
  nemShare: number | null;
}

type GenerationColumn = DataTableColumn & { id: "fuel" | "mw" | "share" | "nemMw" | "nemShare" };

function generationColumns(width: number, withNem: boolean): GenerationColumn[] {
  const columns: GenerationColumn[] = [
    { id: "fuel", label: "Fuel", width: 18, align: "left", flexGrow: 1 },
    { id: "mw", label: "MW", width: 8, align: "right" },
    { id: "share", label: "Share", width: width >= 70 ? 16 : 6, align: "right" },
    ...(withNem ? [
      { id: "nemMw", label: "NEM MW", width: 8, align: "right" } as GenerationColumn,
      { id: "nemShare", label: "NEM %", width: 6, align: "right" } as GenerationColumn,
    ] : []),
  ];
  const fixed = columns.slice(1).reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "fuel" ? { ...column, width: Math.max(12, width - fixed - 1) } : column));
}

export function GenerationView({ focused, width, height, summary, region, setRegion, reloadPrices, oeKey }: {
  focused: boolean;
  width: number;
  height: number;
  summary: NemSummary;
  region: string;
  setRegion: (region: string) => void;
  reloadPrices: () => void;
  /** OpenElectricity API key from the plugin's settings; null leaves the view on AEMO alone. */
  oeKey: string | null;
}) {
  const desktop = useUiCapabilities().nativePaneChrome === true;
  const loader = useCallback((force: boolean) => loadFuelCurrent({ force }), []);
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader);
  // Not forced: the cache's freshness decides; `r` forces.
  useAutoRefresh(updatedAt, useCallback(() => void load(), [load]), { intervalMs: 5 * 60_000 });
  const oeLoader = useMemo(() => (oeKey ? () => loadOpenElectricityRecent(oeKey) : null), [oeKey]);
  const oe = useOpenElectricity(oeLoader, () => (oeKey ? cachedOpenElectricityRecent() : null), CACHE_POLICY.openElectricityRecent.staleMs);
  const oeData = oeKey ? oe.data?.data ?? null : null;

  const current = useMemo(() => {
    if (!data) return null;
    const at = data.rows.reduce((max, row) => Math.max(max, row.at), Number.NEGATIVE_INFINITY);
    const extra = oeData && Number.isFinite(at) ? currentRows(oeData, at) : null;
    return { data: extra?.rows.length ? withFuelRows(data, extra.rows) : data, extra };
  }, [data, oeData]);
  usePaneStatusFooter({
    registrationId: `${PANE_ID}:generation`,
    loading: (loading && !!data) || (oe.loading && !!oeKey),
    error: data ? error : null,
    info: !oeKey ? [AEMO_ONLY] : current?.extra?.rows.length ? [OE_CREDIT] : [],
  });
  usePaneNoticeFooter({
    registrationId: `${PANE_ID}:generation-notices`,
    focused,
    notices: oeKey && (oe.error || (oe.data && current)) ? openElectricityNotices(oe, current?.extra?.rows.length ?? 0) : [],
  });
  const refresh = useCallback(() => { reload(); reloadPrices(); void oe.load(); }, [reload, reloadPrices, oe.load]);
  const handleKey = useRefreshKey(refresh);

  const mix = useMemo(() => (current ? fuelMix(current.data, region) : null), [current, region]);
  const nem = useMemo(() => (current ? fuelMix(current.data, NEM_TOTAL) : null), [current]);
  const withNem = region !== NEM_TOTAL;
  const rows = useMemo<GenerationRow[]>(() => (nem?.fuels ?? []).map((entry) => {
    const own = mix?.fuels.find((candidate) => candidate.fuel.id === entry.fuel.id);
    // Charging is a load, not a share of generation (also at 0 MW, as at night).
    const load = entry.fuel.id === "battery-charging";
    return { fuel: entry.fuel, mw: own?.mw ?? null, share: own && !load ? own.share : null, nemMw: entry.mw, nemShare: load ? null : entry.share };
  }), [mix, nem]);
  const columns = generationColumns(width, withNem);
  const shareWidth = columns.find((column) => column.id === "share")!.width;

  const renderCell = useCallback((row: GenerationRow, column: GenerationColumn, _index: number, state?: { selected: boolean }): DataTableCell => {
    switch (column.id) {
      case "fuel": return { text: row.fuel.label, color: fuelColor(row.fuel.id), attributes: row.fuel.id.startsWith("battery") ? TextAttributes.BOLD : 0 };
      case "mw": return { text: formatMw(row.mw), value: row.mw, color: row.mw ? colors.textBright : colors.textMuted };
      case "share": return shareCell(row.share, fuelColor(row.fuel.id), shareWidth, !!state?.selected, !desktop);
      case "nemMw": return { text: formatMw(row.nemMw), value: row.nemMw, color: colors.textDim };
      case "nemShare": return { text: formatShare(row.nemShare), value: row.nemShare == null ? null : row.nemShare * 100, color: colors.textDim };
    }
  }, [desktop, shareWidth]);

  // Rooftop PV runs well behind dispatch, and charging can trail AEMO by an interval or two: say which they are from.
  const lagging = mix && current?.extra ? openElectricityLag(mix.at, current.extra) : "";
  const meta = mix ? `${formatNemStamp(mix.at, true)} AEST${lagging ? `, ${lagging}` : ""}` : undefined;
  const query = <QueryBar width={width} filters={[regionFilter(region, setRegion)]} meta={meta} />;
  if (!data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {query}
        {loading || !error
          ? <PaneStatusBody loading align="center" loadingLabel="Loading the generation mix..." />
          : <PaneStatusBody error={error} errorTitle="NEM generation mix unavailable." />}
      </Box>
    );
  }
  const price = summary.regions.find((entry) => entry.region === region)?.price ?? null;
  const battery = mix?.fuels.find((entry) => entry.fuel.id === "battery");
  const charging = mix?.fuels.find((entry) => entry.fuel.id === "battery-charging");
  const figures: StatItem[] = mix ? [
    { id: "total", label: "Generation", value: `${formatMw(mix.total)} MW` },
    { id: "renewable", label: "Renewable", value: formatShare(renewableShare(mix)), color: colors.positive },
    { id: "battery", label: "Battery", value: `${formatMw(battery?.mw ?? 0)} MW`, color: fuelColor("battery") },
    ...(charging ? [{ id: "charging", label: "Charging", value: `${formatMw(charging.mw)} MW`, color: fuelColor("battery-charging") }] : []),
    ...(price != null ? [{ id: "price", label: "Spot", value: formatPrice(price), detail: "$/MWh" }] : []),
  ] : [];
  const bars = [mix, withNem ? nem : null].filter((entry): entry is FuelMix => !!entry && entry.total > 0);
  const chart: ChartTableChart | null = bars.length ? {
    render: (size) => <MixBars mixes={bars} width={size.width} />,
    minRows: 1,
    maxRows: bars.length,
    strip: null,
  } : null;
  return (
    <DataTableView<GenerationRow, GenerationColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<ChartTableHeader width={width} height={height} tableRows={rows.length} tableColumns={columns} query={query} figures={figures} chart={chart} />}
      selection={{ kind: "none" }}
      onRootKeyDown={handleKey}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      getItemKey={(row) => row.fuel.id}
      renderCell={renderCell}
      emptyStateTitle={`No generation reported for ${mixRegionName(region)}.`}
    />
  );
}

// --- History: the mix over time, with price and battery discharge -----------------

interface HistoryLoad {
  range: AemoRange;
  fuel: Awaited<ReturnType<typeof loadFuelHistory>>;
  /** 5-minute prices, for the hourly window only; null when they failed or do not apply. */
  prices: Awaited<ReturnType<typeof loadNemHistory>> | null;
  priceError: string | null;
}

type HistoryColumn = DataTableColumn & { id: "fuel" | "average" | "peak" | "low" | "share" };

function historyColumns(width: number): HistoryColumn[] {
  const columns: HistoryColumn[] = [
    { id: "fuel", label: "Fuel", width: 18, align: "left", flexGrow: 1 },
    { id: "average", label: "Avg MW", width: 8, align: "right" },
    { id: "peak", label: "Peak MW", width: 8, align: "right" },
    { id: "low", label: "Low MW", width: 8, align: "right" },
    { id: "share", label: "Energy", width: width >= 76 ? 16 : 6, align: "right" },
  ];
  const fixed = columns.slice(1).reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "fuel" ? { ...column, width: Math.max(12, width - fixed - 1) } : column));
}

/** `1.2k` style ticks for MW, whole dollars for price. */
function axisValue(value: number, unit: string): string {
  if (unit === "$/MWh") return `${value < 0 ? "-" : ""}$${Math.abs(value) >= 1000 ? `${(Math.abs(value) / 1000).toFixed(1)}k` : Math.round(Math.abs(value))}`;
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(Math.abs(value) >= 10_000 ? 0 : 1)}k` : `${Math.round(value)}`;
}

type AemoRange = Exclude<HistoryRange, "24H">;

function windowLabel(range: AemoRange, times: readonly number[]): string {
  const last = times.at(-1);
  if (last == null) return "";
  switch (range) {
    case "48H": return `hourly avg to ${formatNemStamp(last, true)}`;
    case "3M": return `daily avg to ${formatNemStamp(last, false)}`;
    case "12M": return `weekly avg from ${formatNemStamp(last, false)}`;
  }
}

/** Chart series on NEM market time: the mix in the main panel, battery and price below it. */
export function historySeries(history: ReturnType<typeof mixHistory>, prices: ReadonlyMap<number, number> | null): ResolvedSeries[] {
  const cadenceMs = REPORT_HOURS[history.report] * HOUR;
  const make = (id: string, label: string, unit: string, points: ReadonlyArray<{ at: number; value: number }>) => intervalSeries({
    id, label, unit, unitGroup: unit === "MW" ? "au-nem-mw" : "au-nem-price", timeZone: "Australia/Brisbane", cadenceMs, points,
  });
  const series: ResolvedSeries[] = [];
  for (const entry of history.series) {
    const points = entry.points.map((point) => ({ at: point.at, value: point.mw }));
    if (entry.fuel.id === "battery" || entry.fuel.id === "battery-charging") {
      series.push({ ...make(`fuel:${entry.fuel.id}`, entry.fuel.label, "MW", points), color: fuelColor(entry.fuel.id), style: "area", panelId: "battery", axis: "left" });
    } else if (points.some((point) => point.value > 0)) {
      series.push({ ...make(`fuel:${entry.fuel.id}`, entry.fuel.label, "MW", points), color: fuelColor(entry.fuel.id), axis: "left" });
    }
  }
  if (prices?.size) {
    const points = history.times.flatMap((at) => (prices.has(at) ? [{ at, value: prices.get(at)! }] : []));
    series.push({ ...make("price", "Spot price", "$/MWh", points), color: priceLineColor(), panelId: "battery", axis: "right" });
  }
  return series;
}

const HISTORY_PANELS = [{ id: "main", height: 3 }, { id: "battery", height: 2 }];

/**
 * The legend's value for a series: compact, units left to the axes. The
 * legend is one row; when the names and values together would not fit, the
 * values give way so every series is still named.
 */
export function legendFormatter(series: readonly ResolvedSeries[], width: number): (value: number, entry?: ResolvedSeries) => string {
  const format = (value: number, unit: string | undefined) => axisValue(value, unit ?? "MW");
  // Marker and space, the name, a space and a value of about five cells; one cell between entries and the legend's inset.
  const needed = series.reduce((sum, entry) => sum + 2 + entry.label.length + 1 + 5 + 1, 1);
  return needed <= width ? (value, entry) => format(value, entry?.unit) : () => "";
}

interface HistoryViewProps {
  focused: boolean;
  width: number;
  height: number;
  region: string;
  setRegion: (region: string) => void;
  range: HistoryRange;
  setRange: (range: HistoryRange) => void;
  /** OpenElectricity API key from the plugin's settings; null leaves the view on AEMO alone. */
  oeKey: string | null;
}

function historyQueryBar(props: HistoryViewProps, meta: string | undefined) {
  return (
    <QueryBar
      width={props.width}
      filters={[regionFilter(props.region, props.setRegion)]}
      view={{ value: props.range, options: rangeOptions(!!props.oeKey), onChange: (value) => props.setRange(historyRange(value, !!props.oeKey)) }}
      meta={meta}
    />
  );
}

/** AEMO's mix over 48 hours, 3 months or 12 months; with a key, also the last 24 hours of batteries at 5 minutes. */
export function MixHistoryView(props: HistoryViewProps) {
  return props.range === "24H" && props.oeKey
    ? <BatteryDayView {...props} oeKey={props.oeKey} />
    : <FuelHistoryView {...props} range={props.range === "24H" ? "48H" : props.range} />;
}

function FuelHistoryView(props: HistoryViewProps & { range: AemoRange }) {
  const { focused, width, height, region, range, oeKey } = props;
  const desktop = useUiCapabilities().nativePaneChrome === true;
  const loader = useCallback(async (force: boolean): Promise<HistoryLoad> => {
    const [fuel, prices] = await Promise.all([
      loadFuelHistory(range, { force }),
      range === "48H"
        ? loadNemHistory("prices-7d", { force }).then((rows) => ({ rows, error: null }), (error: unknown) => ({ rows: null, error: error instanceof Error ? error.message : String(error) }))
        : Promise.resolve({ rows: null, error: null }),
    ]);
    return { range, fuel, prices: prices.rows, priceError: prices.error };
  }, [range]);
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader, {
    keepPreviousData: true,
    initialData: () => {
      const cached = cachedFuelHistory(range);
      return cached ? { range, fuel: cached, prices: null, priceError: null } : null;
    },
  });
  // Not forced, so the reports' freshness windows apply to an open pane; `r` forces.
  useAutoRefresh(updatedAt, useCallback(() => void load(), [load]));
  const cacheStatus = useCacheStatus(data?.fuel ?? null, loading);
  usePaneStatusFooter({ registrationId: `${PANE_ID}:history`, loading: loading && !!data, error: data ? error : null, stale: cacheStatus.stale, info: cacheStatus.info });
  usePaneNoticeFooter({
    registrationId: `${PANE_ID}:history-notices`,
    focused,
    notices: [...cacheStatus.notices, ...(data?.priceError ? [`Spot prices unavailable: ${data.priceError}`] : [])],
  });
  // OpenElectricity's rooftop solar and battery charging over the same window, every region in one request.
  const times = useMemo(() => (data ? [...new Set(data.fuel.data.rows.map((row) => row.at))].sort((a, b) => a - b) : []), [data]);
  const windowKey = data && times.length ? `${data.range}:${times[0]}:${times.at(-1)}` : null;
  // Keyed by the window, so a refetch of the same AEMO window does not ask OpenElectricity again.
  const oeWindow = useMemo(() => (data && windowKey ? { range: data.range, times } : null), [windowKey]);
  const oeLoader = useMemo(() => (oeKey && oeWindow ? () => loadOpenElectricityHistory(oeKey, oeWindow.range, oeWindow.times) : null), [oeKey, oeWindow]);
  const oe = useOpenElectricity(
    oeLoader,
    () => (oeKey && oeWindow ? cachedOpenElectricityHistory(oeWindow.range, oeWindow.times) : null),
    CACHE_POLICY.openElectricityHistory.staleMs,
  );
  const oeRows = useMemo(() => (oeKey && oeWindow && oe.data ? historyRows(oe.data.data, oeWindow.range, oeWindow.times) : []), [oeKey, oeWindow, oe.data]);
  usePaneStatusFooter({ registrationId: `${PANE_ID}:history-oe-status`, loading: !!oeKey && oe.loading, info: !oeKey ? [AEMO_ONLY] : oeRows.length ? [OE_CREDIT] : [] });
  usePaneNoticeFooter({
    registrationId: `${PANE_ID}:history-oe`,
    focused,
    notices: oeKey && oeWindow && (oe.data || oe.error) ? openElectricityNotices(oe, oeRows.length) : [],
  });
  const refresh = useCallback(() => { reload(); void oe.load(); }, [reload, oe.load]);
  const handleKey = useRefreshKey(refresh);

  // A range switch keeps the last window on screen, read at its own range, until the new one arrives.
  const shown = data?.range ?? range;
  const history = useMemo(() => (data ? mixHistory(withFuelRows(data.fuel.data, oeRows), region, data.range) : null), [data, oeRows, region]);
  const hourly = useMemo(() => (history && data?.prices && region !== NEM_TOTAL && data.range === "48H"
    ? hourlyPrices(data.prices, region, history.times)
    : null), [data, history, region]);
  const series = useMemo(() => (history ? historySeries(history, hourly) : []), [history, hourly]);
  const summaries = useMemo(() => (history ? summariseHistory(history) : []), [history]);
  const columns = historyColumns(width);
  const shareWidth = columns.find((column) => column.id === "share")!.width;

  const renderCell = useCallback((row: FuelWindowSummary, column: HistoryColumn, _index: number, state?: { selected: boolean }): DataTableCell => {
    switch (column.id) {
      case "fuel": return { text: row.fuel.label, color: fuelColor(row.fuel.id), attributes: row.fuel.id.startsWith("battery") ? TextAttributes.BOLD : 0 };
      case "average": return { text: formatMw(row.average), value: row.average, color: colors.textBright };
      case "peak": return { text: formatMw(row.peak?.mw), value: row.peak?.mw ?? null, color: colors.textDim };
      case "low": return { text: formatMw(row.low), value: row.low, color: colors.textDim };
      case "share": return row.fuel.id === "battery-charging"
        ? { text: "—", value: null, color: colors.textMuted }
        : shareCell(row.share, fuelColor(row.fuel.id), shareWidth, !!state?.selected, !desktop);
    }
  }, [desktop, shareWidth]);

  const query = historyQueryBar(props, history ? windowLabel(shown, history.times) : undefined);
  if (!history) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {query}
        {loading || !error
          ? <PaneStatusBody loading align="center" loadingLabel="Loading generation history..." />
          : <PaneStatusBody error={error} errorTitle="NEM generation history unavailable." />}
      </Box>
    );
  }

  const battery = history.series.find((entry) => entry.fuel.id === "battery");
  const charging = history.series.find((entry) => entry.fuel.id === "battery-charging");
  const response = battery ? batteryResponse(battery.points, hourly ?? new Map(), charging?.points) : null;
  const total = summaries.reduce((sum, entry) => sum + Math.max(0, entry.average), 0);
  const renewable = total > 0 ? summaries.reduce((sum, entry) => sum + (entry.fuel.renewable ? entry.share : 0), 0) : null;
  const hourlyWindow = shown === "48H";
  // Most important first: the kit drops figures from the end when rows run short.
  const figures: StatItem[] = [
    ...(response?.dischargePrice != null ? [{
      id: "discharge",
      label: "Battery sold at",
      value: formatPrice(response.dischargePrice),
      detail: response.averagePrice != null ? `spot avg ${formatPrice(response.averagePrice)}` : undefined,
      color: fuelColor("battery"),
    }] : []),
    ...(response?.chargePrice != null ? [{
      id: "charge",
      label: "Charged at",
      value: formatPrice(response.chargePrice),
      color: fuelColor("battery-charging"),
    }] : []),
    ...(response?.peak ? [{
      id: "peak",
      label: "Battery peak",
      value: `${formatMw(response.peak.mw)} MW`,
      detail: formatNemStamp(response.peak.at, hourlyWindow),
      color: fuelColor("battery"),
    }] : []),
    { id: "renewable", label: "Renewable", value: formatShare(renewable), color: colors.positive },
  ];
  const chart: ChartTableChart = {
    series,
    panels: HISTORY_PANELS,
    formatValue: legendFormatter(series, width),
    formatAxisValue: (value, domain) => axisValue(value, domain.unit),
    // The kit stretches anything under two weeks to two weeks; the 48-hour window should fill the plot.
    ...(history.times.length >= 2 ? { viewport: { start: new Date(history.times[0]!), end: new Date(history.times.at(-1)!) } } : {}),
    loading: loading && series.length === 0,
    empty: `No generation history for ${mixRegionName(region)}`,
  };
  return (
    <DataTableView<FuelWindowSummary, HistoryColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<ChartTableHeader width={width} height={height} tableRows={summaries.length} tableColumns={columns} query={query} figures={figures} chart={chart} />}
      selection={{ kind: "none" }}
      onRootKeyDown={handleKey}
      columns={columns}
      items={summaries}
      sortColumnId={null}
      sortDirection="asc"
      getItemKey={(row) => row.fuel.id}
      renderCell={renderCell}
      emptyStateTitle={`No generation history for ${mixRegionName(region)}.`}
    />
  );
}

// --- Batteries at 5 minutes (OpenElectricity) ---------------------------------------

interface BatteryDayRow {
  id: "rooftop" | "discharging" | "charging" | "net";
  label: string;
  color: string;
  points: MixPoint[];
  /** Spot price weighted by this row's MW; none for net. */
  price: number | null;
}

type BatteryDayColumn = DataTableColumn & { id: "label" | "average" | "peak" | "peakAt" | "price" };

function batteryDayColumns(width: number): BatteryDayColumn[] {
  const columns: BatteryDayColumn[] = [
    { id: "label", label: "Series", width: 18, align: "left", flexGrow: 1 },
    { id: "average", label: "Avg MW", width: 8, align: "right" },
    { id: "peak", label: "Peak MW", width: 8, align: "right" },
    { id: "peakAt", label: "Peak at", width: 12, align: "right" },
    { id: "price", label: "At $/MWh", width: 10, align: "right" },
  ];
  const fixed = columns.slice(1).reduce((total, column) => total + column.width + 1, 3);
  return columns.map((column) => (column.id === "label" ? { ...column, width: Math.max(12, width - fixed - 1) } : column));
}

const FIVE_MINUTES = 300_000;

/** The 24-hour battery view's chart: charging below zero, discharge above, the 5-minute price beneath. */
export function batteryDaySeries(data: OeData, region: string, prices: readonly { at: number; value: number }[]): ResolvedSeries[] {
  const make = (id: string, label: string, unit: string, points: ReadonlyArray<{ at: number; value: number }>) => intervalSeries({
    id, label, unit, unitGroup: unit === "MW" ? "au-nem-mw" : "au-nem-price", timeZone: "Australia/Brisbane", cadenceMs: FIVE_MINUTES, points,
  });
  const discharge = oeSeries(data, region, "discharging").map((point) => ({ at: point.at, value: point.mw }));
  const charging = oeSeries(data, region, "charging").map((point) => ({ at: point.at, value: -point.mw }));
  const series: ResolvedSeries[] = [];
  if (discharge.length) series.push({ ...make("battery", "Battery discharge", "MW", discharge), color: fuelColor("battery"), style: "area", axis: "left" });
  if (charging.length) series.push({ ...make("battery-charging", "Battery charging", "MW", charging), color: fuelColor("battery-charging"), style: "area", axis: "left" });
  if (prices.length) series.push({ ...make("price", "Spot price", "$/MWh", prices), color: priceLineColor(), panelId: "price", axis: "left" });
  return series;
}

const BATTERY_DAY_PANELS = [{ id: "main", height: 3 }, { id: "price", height: 2 }];

function BatteryDayView(props: HistoryViewProps & { oeKey: string }) {
  const { focused, width, height, region, oeKey } = props;
  const oeLoader = useMemo(() => () => loadOpenElectricityRecent(oeKey), [oeKey]);
  const oe = useOpenElectricity(oeLoader, cachedOpenElectricityRecent, CACHE_POLICY.openElectricityRecent.staleMs);
  const priceLoader = useCallback((force: boolean) => loadNemHistory("prices-7d", { force }), []);
  const prices = useAsyncResource(priceLoader);
  // Prices move every five minutes; without this the newest battery intervals would go unpriced.
  const loadPrices = prices.load;
  useAutoRefresh(prices.updatedAt, useCallback(() => void loadPrices(), [loadPrices]), { intervalMs: 5 * 60_000 });
  const cacheStatus = useCacheStatus(oe.data ?? null, oe.loading);
  usePaneStatusFooter({
    registrationId: `${PANE_ID}:battery-day`,
    loading: (oe.loading && !!oe.data) || (prices.loading && !!prices.data),
    error: oe.data ? oe.error : null,
    stale: cacheStatus.stale,
    info: [...cacheStatus.info, ...(oe.data ? [OE_CREDIT] : [])],
  });
  usePaneNoticeFooter({
    registrationId: `${PANE_ID}:battery-day-notices`,
    focused,
    notices: [...cacheStatus.notices, ...(prices.error ? [`Spot prices unavailable: ${prices.error}`] : [])],
  });
  const refresh = useCallback(() => { void oe.load(); prices.reload(); }, [oe.load, prices.reload]);
  const handleKey = useRefreshKey(refresh);

  const data = oe.data?.data ?? null;
  const spot = useMemo(() => prices.data ?? [], [prices.data]);
  const arbitrage = useMemo(() => (data ? batteryArbitrage(data, spot, region) : null), [data, spot, region]);
  const rows = useMemo<BatteryDayRow[]>(() => {
    if (!data || !arbitrage) return [];
    const list: BatteryDayRow[] = [
      { id: "rooftop", label: "Rooftop solar", color: fuelColor("rooftop"), points: oeSeries(data, region, "rooftop"), price: priceWeighted(data, spot, region, "rooftop") },
      { id: "discharging", label: "Battery discharge", color: fuelColor("battery"), points: oeSeries(data, region, "discharging"), price: arbitrage.soldAt },
      { id: "charging", label: "Battery charging", color: fuelColor("battery-charging"), points: oeSeries(data, region, "charging").map((point) => ({ at: point.at, mw: -point.mw })), price: arbitrage.boughtAt },
      { id: "net", label: "Battery net", color: colors.text, points: batteryNet(data, region), price: null },
    ];
    return list.filter((row) => row.points.length > 0);
  }, [data, arbitrage, region, spot]);
  // The price line covers the battery figures' span, one region at a time (the NEM has no one price).
  const span = useMemo(() => {
    const all = rows.filter((row) => row.id !== "rooftop").flatMap((row) => row.points.map((point) => point.at));
    return all.length ? { start: Math.min(...all), end: Math.max(...all) } : null;
  }, [rows]);
  const priceLine = useMemo(() => (region === NEM_TOTAL || !span ? [] : spot
    .filter((point) => point.region === region && point.actual && point.at >= span.start && point.at <= span.end)
    .map((point) => ({ at: point.at, value: point.price }))), [region, spot, span]);
  const series = useMemo(() => (data ? batteryDaySeries(data, region, priceLine) : []), [data, region, priceLine]);
  const columns = batteryDayColumns(width);

  const renderCell = useCallback((row: BatteryDayRow, column: BatteryDayColumn): DataTableCell => {
    const peak = row.points.reduce<MixPoint | null>((best, point) => (!best || Math.abs(point.mw) > Math.abs(best.mw) ? point : best), null);
    switch (column.id) {
      case "label": return { text: row.label, color: row.color, attributes: row.id === "net" ? TextAttributes.BOLD : 0 };
      case "average": {
        const average = row.points.length ? row.points.reduce((sum, point) => sum + point.mw, 0) / row.points.length : null;
        return { text: formatMw(average), value: average, color: colors.textBright };
      }
      case "peak": return { text: formatMw(peak?.mw), value: peak?.mw ?? null, color: colors.textDim };
      // With the day: the window crosses midnight.
      case "peakAt": return { text: peak ? formatNemStamp(peak.at, true) : "—", value: peak ? new Date(peak.at) : null, color: colors.textMuted };
      case "price": return { text: formatPrice(row.price), value: row.price, color: colors.text };
    }
  }, []);

  const last = span?.end;
  const query = historyQueryBar(props, last != null ? `5-min, 24h to ${formatNemStamp(last, true)}` : undefined);
  if (!data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {query}
        {oe.loading || !oe.error
          ? <PaneStatusBody loading align="center" loadingLabel="Loading battery and rooftop data..." />
          : <PaneStatusBody error={oe.error} errorTitle="OpenElectricity data unavailable." />}
      </Box>
    );
  }
  // Most important first: the kit drops figures from the end when rows run short.
  const figures: StatItem[] = arbitrage ? [
    ...(arbitrage.spread != null ? [{ id: "spread", label: "Spread", value: formatPrice(arbitrage.spread), detail: "sold − charged", color: colors.positive }] : []),
    ...(arbitrage.soldAt != null ? [{ id: "sold", label: "Sold at", value: formatPrice(arbitrage.soldAt), color: fuelColor("battery") }] : []),
    ...(arbitrage.boughtAt != null ? [{ id: "bought", label: "Charged at", value: formatPrice(arbitrage.boughtAt), color: fuelColor("battery-charging") }] : []),
    // AEMO's price report has no demand to weight the regions by, so the NEM's is their plain mean, and says so.
    ...(arbitrage.averagePrice != null ? [{ id: "spot", label: "Spot avg", value: formatPrice(arbitrage.averagePrice), ...(region === NEM_TOTAL ? { detail: "regions' mean" } : {}) }] : []),
  ] : [];
  const chart: ChartTableChart = {
    series,
    panels: BATTERY_DAY_PANELS,
    formatValue: legendFormatter(series, width),
    formatAxisValue: (value, domain) => axisValue(value, domain.unit),
    ...(span ? { viewport: { start: new Date(span.start), end: new Date(span.end) } } : {}),
    loading: oe.loading && series.length === 0,
    empty: `No battery data for ${mixRegionName(region)}`,
  };
  return (
    <DataTableView<BatteryDayRow, BatteryDayColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<ChartTableHeader width={width} height={height} tableRows={rows.length} tableColumns={columns} query={query} figures={figures} chart={chart} />}
      selection={{ kind: "none" }}
      onRootKeyDown={handleKey}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      getItemKey={(row) => row.id}
      renderCell={renderCell}
      emptyStateTitle={`No battery or rooftop data for ${mixRegionName(region)}.`}
    />
  );
}

// --- FCAS: the latest interval's ancillary service prices --------------------------

type FcasRow = (typeof FCAS_SERVICES)[number];
type FcasColumn = DataTableColumn & { id: string };

export function FcasView({ focused, width, height, summary, reload }: {
  focused: boolean;
  width: number;
  height: number;
  summary: NemSummary;
  reload: () => void;
}) {
  const handleKey = useRefreshKey(reload);
  const byRegion = useMemo(() => new Map<string, RegionFcas>(summary.fcas.map((entry) => [entry.region, entry])), [summary]);
  const regions = Object.keys(NEM_REGIONS).filter((region) => byRegion.has(region));
  const regionWidth = 8;
  const columns: FcasColumn[] = [
    { id: "service", label: "Service $/MW/h", width: Math.max(16, width - 3 - regions.length * (regionWidth + 1) - 1), align: "left", flexGrow: 1 },
    ...regions.map((region) => ({ id: region, label: regionCode(region), width: regionWidth, align: "right" as const })),
  ];
  const renderCell = useCallback((row: FcasRow, column: FcasColumn): DataTableCell => {
    if (column.id === "service") return { text: row.label, color: colors.text };
    const value = byRegion.get(column.id)?.prices[row.key] ?? null;
    return { text: formatPrice(value), value, color: value != null && value >= 100 ? colors.warning : colors.textDim };
  }, [byRegion]);
  return (
    <DataTableView<FcasRow, FcasColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      selection={{ kind: "none" }}
      onRootKeyDown={handleKey}
      columns={columns}
      items={[...FCAS_SERVICES]}
      sortColumnId={null}
      sortDirection="asc"
      getItemKey={(row) => row.key}
      renderCell={renderCell}
      emptyStateTitle="No FCAS prices reported."
    />
  );
}
