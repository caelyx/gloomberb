import { useCallback, useMemo, useState } from "react";
import {
  ChartTableHeader, CurveSurface, curveGhostColors, curveStrip, curveSurfaceMinRows, DataTableView, formatPercentAxis,
  PaneStatusBody, QueryBar, useChartTableSelection, usePaneNoticeFooter, usePaneStatusFooter, type DataTableColumn,
  type StatItem,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePluginPaneState, useShortcut } from "gloomberb/react";
import { Box } from "gloomberb/ui";
import { colors, priceColor } from "gloomberb/theme";
import { isPlainKey } from "gloomberb/utils";
import type { AcgbService } from "../rba/client";
import { curveSeries, spreadFigures, tenorRows, type TenorRow } from "./rows";

export const ACGB_REGISTRATION_ID = "acgb-curve";

const CAPTION = "Yield % by maturity";
const TENOR: DataTableColumn = { id: "tenor", label: "Tenor", width: 7, align: "left" };
const YIELD: DataTableColumn = { id: "yield", label: "Yield", width: 8, align: "right" };
const CHANGE_1D: DataTableColumn = { id: "change1d", label: "1D chg", width: 8, align: "right" };
const COLUMNS: DataTableColumn[] = [
  TENOR, YIELD, CHANGE_1D,
  { id: "change1w", label: "1W chg", width: 8, align: "right" },
  { id: "change1m", label: "1M chg", width: 8, align: "right" },
];
// Beside the US curve, as GC beside a compare date: its yield and the spread to it, then the day's move.
const US_COLUMNS: DataTableColumn[] = [
  TENOR, YIELD,
  { id: "us", label: "UST", width: 8, align: "right" },
  { id: "spreadToUs", label: "Spread", width: 8, align: "right" },
  CHANGE_1D,
];
const tenorKey = (row: TenorRow) => row.id;
// Left and Right step along the maturities, the way the curve reads.
const tenorPosition = (row: TenorRow) => new Date(row.years * 86_400_000);

const formatYield = (value: number) => `${value.toFixed(2)}%`;
/** A change in percentage points, read in basis points: `+7bp`, `-12bp`. */
function formatYieldChange(change: number): string {
  const bp = Math.round(change * 100);
  return `${bp > 0 ? "+" : ""}${bp === 0 ? 0 : bp}bp`;
}

export interface AcgbCurveViewProps {
  width: number;
  height: number;
  focused: boolean;
  service: AcgbService;
}

export function AcgbCurveView({ width, height, focused, service }: AcgbCurveViewProps) {
  const loader = useCallback((force: boolean) => service.load({ force }), [service]);
  const initialData = useCallback(() => service.cached(), [service]);
  const resource = useAsyncResource(loader, { initialData });
  const { load } = resource;
  useAutoRefresh(resource.updatedAt, load);
  // Plain `r` refreshes the focused pane, past the cache, with no footer hint:
  // what the host's usePaneRefreshKey does for built-in panes.
  const snapshot = resource.data?.data ?? null;
  const asOf = snapshot?.latest.date ?? null;

  // The US curve for the ACGB session's date, not today's: a spread compares one day.
  const [showUs, setShowUs] = usePluginPaneState<boolean>("acgb:us", false);
  const usDate = showUs ? asOf : null;
  const usLoader = useCallback(async (force: boolean) => ({ date: usDate, curve: (await service.loadUsCurve(usDate!, { force })).data }),
    [service, usDate]);
  const usResource = useAsyncResource(usDate ? usLoader : null);
  const us = usDate && usResource.data?.date === usDate ? usResource.data.curve : null;

  useShortcut((event) => {
    if (event.defaultPrevented || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void load(true);
    if (usDate) void usResource.load(true);
  }, { enabled: focused });

  const [selectedTenor, setSelectedTenor] = useState<string | null>(null);
  const rows = useMemo(() => snapshot ? tenorRows(snapshot, us) : [], [snapshot, us]);
  const selectedId = rows.some((row) => row.id === selectedTenor) ? selectedTenor! : rows[0]?.id ?? null;
  useChartTableSelection({ rows, getId: tenorKey, getDate: tenorPosition, selectedId, onSelect: setSelectedTenor, focused });

  // `colors` follows the theme; the strings it gives now are what the memos depend on.
  const { positive, negative, neutral, textMuted, textDim, warning, borderFocused } = colors;
  const series = useMemo(() => snapshot
    ? curveSeries(snapshot, { current: positive, ghosts: curveGhostColors({ textMuted, textDim, warning }), us: borderFocused }, us) : [],
  [snapshot, us, positive, textMuted, textDim, warning, borderFocused]);
  const figures = useMemo<StatItem[]>(() => snapshot ? spreadFigures(snapshot).map(({ id, value, change1d }) => ({
    id, label: id, value: formatYieldChange(value),
    detail: `${change1d == null ? "--" : formatYieldChange(change1d)} 1D`,
    tone: Math.round(value * 100) < 0 ? "warning" : undefined,
  })) : [], [snapshot]);

  const error = resource.error ?? resource.data?.refreshError ?? null;
  // The RBA prints the week's closes on Friday, so the session shown is days
  // behind today. Kept short: a refresh error shares the line and the footer
  // shrinks every segment to fit.
  const info = useMemo(() => asOf ? [{ id: "asOf", parts: [{ text: `as of ${asOf}`, tone: "muted" as const }] }] : [], [asOf]);
  usePaneStatusFooter({
    registrationId: ACGB_REGISTRATION_ID,
    loading: resource.loading,
    error,
    stale: !!snapshot && (resource.data?.stale ?? false),
    info,
  });
  usePaneNoticeFooter({
    registrationId: `${ACGB_REGISTRATION_ID}:notices`,
    notices: usDate && usResource.error ? [`US curve unavailable: ${usResource.error}`] : [],
    focused,
  });
  const columns = us ? US_COLUMNS : COLUMNS;

  const strip = curveStrip(series, formatYield, { caption: "Yield %", selectedPointId: selectedId });
  const renderCell = useCallback((row: TenorRow, column: DataTableColumn) => {
    if (column.id === "tenor") return { text: row.id };
    if (column.id === "yield") return { text: formatYield(row.yield) };
    const value = row[column.id as "change1d" | "change1w" | "change1m" | "us" | "spreadToUs"];
    if (value == null) return { text: "--", color: textMuted };
    if (column.id === "us") return { text: formatYield(value) };
    // A level, not a move: uncoloured.
    if (column.id === "spreadToUs") return { text: formatYieldChange(value) };
    // Colour follows the shown basis points, so a move that rounds to 0bp stays neutral.
    return { text: formatYieldChange(value), color: priceColor(Math.round(value * 100), colors) };
  }, [textMuted, positive, negative, neutral]);

  // Shown only when the US has no session on the ACGB date, so the two dates differ.
  const meta = us && us.date !== asOf ? `UST as of ${us.date}` : undefined;
  const bodyHeight = Math.max(1, height - 1);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <QueryBar width={width} meta={meta}
        filters={[{ id: "us", kind: "toggle", label: "vs UST", value: showUs, onChange: setShowUs }]} />
      <PaneStatusBody loading={resource.loading && !snapshot} error={snapshot ? null : error}
        loadingLabel="Loading Australian Government bond curve..." subject="Australian Government bond curve">
        <DataTableView<TenorRow>
          focused={focused} rootWidth={width} rootHeight={bodyHeight}
          columns={columns} items={rows} getItemKey={tenorKey} renderCell={renderCell}
          selection={{ kind: "id", selectedId, getId: tenorKey, onChange: (id) => setSelectedTenor(id) }}
          onActivate={(row) => setSelectedTenor(row.id)} sortColumnId={null} sortDirection="asc"
          emptyStateTitle="No tenors."
          rootBefore={<ChartTableHeader width={width} height={bodyHeight} tableRows={rows.length} tableColumns={columns} figures={figures}
            chart={strip ? {
              render: (size) => <CurveSurface series={series} width={size.width} height={size.height} display="chart"
                caption={CAPTION} xScale="log" formatValue={formatYield} formatChange={formatYieldChange}
                formatAxisValue={formatPercentAxis} selectedPointId={selectedId}
                onSelectedPointChange={(id) => setSelectedTenor(id)} />,
              minRows: curveSurfaceMinRows({ series, width, caption: CAPTION }),
              strip,
            } : null} />}
        />
      </PaneStatusBody>
    </Box>
  );
}
