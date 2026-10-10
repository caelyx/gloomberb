import { useCallback, useMemo } from "react";
import {
  chartTableChromeRows,
  ChartTableHeader,
  CurveSurface,
  curveGhostColors,
  curveStrip,
  curveSurfaceMinRows,
  DataTableView,
  formatPercentAxis,
  PaneStatusBody,
  useChartTableSelection,
  usePaneNoticeFooter,
  usePaneStatusLinkFooter,
  usePaneTabs,
  type CurveSeries,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type StatItem,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePluginPaneState } from "gloomberb/react";
import { colors, priceColor } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { formatRate } from "../rba/view";
import { useCacheStatus } from "../shared/cache-status";
import { formatDay, sydneyToday } from "../shared/time";
import { cachedRbap, loadRbap } from "./client";
import { moveOddsText, moveSteps } from "./model";
import { bpText, meetingLabel, pathNotices, priceText, rbapView, stepsText, type ContractRow, type PathRow, type RbapView } from "./view";

export const RBAP_PANE_ID = "au-rbap";

const RATE_TRACKER = "https://www.asx.com.au/markets/trade-our-derivatives-market/futures-market/rba-rate-tracker";

type Tab = "path" | "contracts";
const TABS: Array<{ label: string; value: Tab }> = [
  { label: "Path", value: "path" },
  { label: "Contracts", value: "contracts" },
];

// What each meeting prices leads, as on WIRP; the implied level follows. "Priced" is odds × 25 bp, the
// move the market prices at that meeting, not a forecast that the RBA moves by a fraction of a step.
type PathColumn = DataTableColumn & { id: "date" | "odds" | "move" | "rate" | "cumulative" | "moves" };
const PATH_COLUMNS: PathColumn[] = [
  { id: "date", label: "Meeting", width: 12, align: "left" },
  { id: "odds", label: "P(move)", width: 10, align: "right" },
  { id: "move", label: "Priced", width: 9, align: "right" },
  { id: "rate", label: "Implied", width: 9, align: "right" },
  { id: "cumulative", label: "Vs now", width: 10, align: "right" },
  { id: "moves", label: "Moves", width: 7, align: "right" },
];

type ContractColumn = DataTableColumn & { id: "label" | "rate" | "settlement" | "last" | "bid" | "ask" | "volume" };
const CONTRACT_COLUMNS: ContractColumn[] = [
  { id: "label", label: "Month", width: 10, align: "left" },
  { id: "rate", label: "Cash rate", width: 10, align: "right" },
  { id: "settlement", label: "Settle", width: 8, align: "right" },
  { id: "last", label: "Last", width: 8, align: "right" },
  { id: "bid", label: "Bid", width: 8, align: "right" },
  { id: "ask", label: "Ask", width: 8, align: "right" },
  { id: "volume", label: "Volume", width: 8, align: "right" },
];

const CAPTION = "Implied cash rate target % by RBA meeting";

/** Hikes up, cuts down, by the sign the text shows, so a move that rounds to zero stays neutral. */
function signColor(value: number | null, digits: number): string {
  return value == null || !Number.isFinite(value) ? colors.textDim : priceColor(Number(value.toFixed(digits)));
}

/** The implied path, today's target as a reference line, then the look-backs. */
function pathCurves(view: RbapView): CurveSeries[] {
  const point = (date: string, rate: number | null, estimated: boolean) => ({ id: date, label: meetingLabel(date, estimated), x: Date.parse(date), value: rate });
  const points = view.meetings.map((row) => point(row.date, row.rate, row.estimated));
  const series: CurveSeries[] = [{ id: "implied", label: "Implied", role: "primary", style: "step", color: colors.positive, points }];
  if (view.target != null && points.length) {
    series.push({ id: "target", label: "Target", role: "reference", color: colors.borderFocused, points: points.map((entry) => ({ ...entry, value: view.target })) });
  }
  const ghostColors = curveGhostColors(colors);
  for (const ghost of view.ghosts) {
    series.push({ id: ghost.label, label: ghost.label, role: "ghost", style: "step", asOf: ghost.settledOn, color: ghostColors[ghost.label],
      points: ghost.points.map((entry) => point(entry.date, entry.rate, entry.estimated)) });
  }
  return series;
}

function pathCell(row: PathRow, column: PathColumn): DataTableCell {
  switch (column.id) {
    case "date": return row.estimated
      ? { text: `~${formatDay(row.date)}`, value: row.date, color: colors.textMuted }
      : { text: formatDay(row.date), value: row.date };
    case "odds": return { text: moveOddsText(row.move), value: moveSteps(row.move), color: signColor(moveSteps(row.move), 2) };
    case "move": return { text: bpText(row.move, 1), value: row.move, color: signColor(row.move * 100, 1) };
    case "rate": return { text: formatRate(row.rate), value: row.rate, color: colors.textBright };
    case "cumulative": return { text: bpText(row.cumulative, 1), value: row.cumulative, color: signColor(row.cumulative * 100, 1) };
    case "moves": return { text: stepsText(row.cumulative), value: moveSteps(row.cumulative), color: signColor(moveSteps(row.cumulative), 2) };
  }
}

function contractCell(row: ContractRow, column: ContractColumn): DataTableCell {
  switch (column.id) {
    case "label": return { text: row.label, value: row.month };
    case "rate": return { text: formatRate(row.rate), value: row.rate, color: colors.textBright };
    case "settlement": return { text: priceText(row.settlement), value: row.settlement };
    // A last trade from an earlier day is dimmed: the settlement is ASX's mark, not a trade.
    case "last": return { text: priceText(row.last), value: row.last, color: row.traded ? colors.text : colors.textDim };
    case "bid": return { text: priceText(row.bid), value: row.bid, color: colors.textMuted };
    case "ask": return { text: priceText(row.ask), value: row.ask, color: colors.textMuted };
    case "volume": return { text: String(row.volume), value: row.volume, color: row.volume ? colors.text : colors.textDim };
  }
}

const meetingKey = (row: PathRow) => row.date;
const meetingDate = (row: PathRow) => new Date(row.date);

/** RBAP: the RBA path the ASX 30-day interbank cash rate futures price, WIRP's Australian counterpart. */
export function RbapPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = usePluginPaneState<Tab>("tab", "path");
  const [selected, setSelected] = usePluginPaneState<string | null>("meeting", null);
  const [contract, setContract] = usePluginPaneState<string | null>("contract", null);
  const loader = useCallback((force: boolean) => loadRbap({ force }), []);
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader, { initialData: cachedRbap });
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(data?.meta, loading);
  const tabs = usePaneTabs({ tabs: TABS, activeValue: tab, onSelect: (value) => setTab(value as Tab), focused, dense: true });
  const view = useMemo(() => (data ? rbapView(data, sydneyToday()) : null), [data]);
  const meetings = view?.meetings ?? [];
  const selectedId = meetings.some((row) => row.date === selected) ? selected! : meetings[0]?.date ?? null;
  useChartTableSelection({ rows: meetings, getId: meetingKey, getDate: meetingDate, selectedId, onSelect: setSelected, focused, enabled: tab === "path" });

  usePaneStatusLinkFooter({
    registrationId: RBAP_PANE_ID,
    focused,
    url: RATE_TRACKER,
    loading: loading && !!data,
    error: data ? error : null,
    info: [
      ...(view?.settledOn ? [{ id: "settled", parts: [{ text: `settlement ${formatDay(view.settledOn)}`, tone: "muted" as const }] }] : []),
      ...cacheStatus.info,
    ],
    stale: cacheStatus.stale,
  });
  usePaneNoticeFooter({
    registrationId: `${RBAP_PANE_ID}:notices`,
    focused,
    notices: [
      ...(view ? pathNotices(view, sydneyToday()) : []),
      ...(data?.errors ?? []),
      ...cacheStatus.notices,
    ],
  });

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const curves = useMemo(() => (view ? pathCurves(view) : []), [view]);
  const next = meetings[0];
  const last = meetings.at(-1);
  const stats: StatItem[] = view ? [
    ...(next ? [{ id: "next", label: "Next meeting", value: moveOddsText(next.move), color: signColor(moveSteps(next.move), 2), detail: `${next.estimated ? "~" : ""}${formatDay(next.date)}` }] : []),
    { id: "target", label: "Cash rate target", value: formatRate(view.target), detail: view.targetAsOf ? formatDay(view.targetAsOf) : undefined },
    { id: "cash", label: "Cash rate", value: formatRate(view.cashRate), detail: view.cashRate == null ? "path from front contract" : `${bpText(view.spread)} to target` },
    ...(tab === "path" && last && last !== next ? [{ id: "end", label: `By ${meetingLabel(last.date, last.estimated)}`, value: bpText(last.cumulative), color: signColor(last.cumulative * 100, 0), detail: `${stepsText(last.cumulative)} moves` }] : []),
  ] : [];

  const bodyHeight = Math.max(1, height - tabs.rows);
  const strip = tab === "path" ? curveStrip(curves, formatRate, { caption: "Implied target", selectedPointId: selectedId }) : null;
  const pathChart = strip ? {
    render: (size: { width: number; height: number }) => <CurveSurface series={curves} width={size.width} height={size.height} display="chart"
      caption={CAPTION} xScale="linear" formatValue={formatRate} formatChange={bpText}
      formatAxisValue={formatPercentAxis} selectedPointId={selectedId} onSelectedPointChange={setSelected} />,
    minRows: curveSurfaceMinRows({ series: curves, width, caption: CAPTION }),
    strip,
  } : null;
  const header = (columns: DataTableColumn[], rows: number, chart: typeof pathChart = null) => (
    <ChartTableHeader width={width} height={bodyHeight} figures={stats} tableChromeRows={chartTableChromeRows(columns, width)} tableRows={rows} chart={chart} />
  );

  let body;
  if (!view) {
    body = loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel="Loading cash rate futures..." />
      : <PaneStatusBody error={error} errorTitle="Cash rate futures unavailable." />;
  } else if (tab === "path") {
    body = (
      <DataTableView<PathRow, PathColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        rootBefore={header(PATH_COLUMNS, meetings.length, pathChart)}
        selection={{ kind: "id", selectedId, getId: meetingKey, onChange: setSelected }}
        onRootKeyDown={handleKey}
        columns={PATH_COLUMNS}
        items={meetings}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={meetingKey}
        renderCell={pathCell}
        selectedTextOverridesCellColor
        emptyStateTitle={view.unanchored ? "No path without the cash rate: see the notice below." : "No upcoming meetings the futures can price."}
      />
    );
  } else {
    body = (
      <DataTableView<ContractRow, ContractColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        rootBefore={header(CONTRACT_COLUMNS, view.contracts.length)}
        selection={{ kind: "id", selectedId: contract, getId: (row) => row.symbol, onChange: setContract }}
        onRootKeyDown={handleKey}
        columns={CONTRACT_COLUMNS}
        items={view.contracts}
        sortColumnId={null}
        sortDirection="asc"
        getItemKey={(row) => row.symbol}
        renderCell={contractCell}
        selectedTextOverridesCellColor
        emptyStateTitle="No cash rate futures listed."
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
