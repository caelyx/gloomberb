// QCR: the current best on each metric (brief §4), and what changed between
// dataset versions (the quarterly-briefing view).
import { useCallback, useMemo, useRef } from "react";
import {
  buildSectionedRows,
  DataTableStackView,
  DataTableView,
  EMPTY_TABLE_CELL,
  EmptyState,
  isSectionedItemRow,
  QueryBar,
  renderSectionedRowHeader,
  StatGrid,
  usePaneTabs,
  type DataTableCell,
  type DataTableColumn,
  type SectionedRow,
} from "gloomberb/components";
import { usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, type ScrollBoxRenderable } from "gloomberb/ui";
import { fmtCount, fmtError, fmtTime, type ErrorFormat } from "../format";
import { PANE_IDS } from "../ids";
import { changelogCounts, diffSnapshots, type RecordChange } from "../model/changes";
import { effectiveToday, LOOKBACK_VALUES, localToday } from "../model/lookback";
import { CODE_FAMILY } from "../model/detail";
import { disputedResults } from "../model/records";
import { REGISTRY, type MetricUnit } from "../model/registry";
import { recordRows, type RecordReportRow } from "../model/report";
import type { RecordsSnapshot } from "../model/snapshot";
import type { Dataset, Result } from "../schema";
import { ResultDetail } from "./detail";
import { MODALITY_LABELS } from "./devices";
import { useSourceFooter } from "./shared/footer";
import { LOOKBACK_LABELS, useErrorFormat, useLookback } from "./shared/settings";

type Item =
  | { kind: "record"; key: string; row: RecordReportRow }
  | { kind: "disputed"; key: string; result: Result };
type Row = SectionedRow<Item>;
type ColumnId = "record" | "value" | "vendor" | "device" | "date" | "evidence" | "notes" | "claimed";
type Column = DataTableColumn & { id: ColumnId };

export const RECORD_COLUMNS: Column[] = [
  { id: "record", label: "Record", width: 30, align: "left", flexGrow: 1 },
  { id: "value", label: "Value", width: 10, align: "right" },
  { id: "vendor", label: "Vendor", width: 11, align: "left" },
  { id: "device", label: "Device", width: 14, align: "left" },
  { id: "date", label: "Date", width: 10, align: "left" },
  { id: "evidence", label: "Ev", width: 2, align: "left" },
  { id: "notes", label: "Notes", width: 18, align: "left" },
  { id: "claimed", label: "Claimed", width: 9, align: "right" },
];

const FLAG_TEXT: Record<string, string> = {
  press_only: "press only",
  t2_dd_fallback: "DD, not echo",
  extrapolated: "extrapolated",
  normalised_by_k: "per block ÷ k",
};

export function formatMetric(unit: MetricUnit, value: number | null, errorFormat: ErrorFormat): string {
  if (value === null) return "—";
  switch (unit) {
    case "count": return fmtCount(value);
    case "error": return fmtError(value, errorFormat);
    case "time": return fmtTime(value);
    case "ratio": return value >= 100 ? fmtCount(value) : String(Number(value.toPrecision(3)));
    case "distance": return `d=${value}`;
  }
}

/**
 * Notes under the exported table. The Value column mixes counts, error rates
 * and times, and a Unit column would not fit beside Claimed at the default
 * width, so the export says once what its raw numbers are.
 */
export const RECORD_EXPORT_NOTES: readonly (readonly string[])[] = [
  ["Value and Claimed are raw SI values: error rates as fractions (0.00079, not 0.079 %), times in seconds; counts, ratios and code distances as plain numbers."],
];

/**
 * A record row's cell. Each number cell carries its raw SI `value`, which CSV
 * export writes instead of the text: exports stay raw fractions and seconds,
 * whatever the error format shows (ERROR_FORMAT_FIELD).
 */
export function recordItemCell(r: RecordReportRow, column: ColumnId, errorFormat: ErrorFormat): DataTableCell {
  const label = r.group ? `${r.label} · ${groupLabel(r.group)}` : r.label;
  switch (column) {
    // Detected-only logical qubits are greyed: they are not error-corrected (brief §4).
    case "record": return { text: label, color: r.section === "gate" && r.metric !== "max_logical_detected" ? colors.text : colors.textDim };
    case "value": return { text: formatMetric(r.unit, r.value, errorFormat), value: r.value, color: r.metric === "max_logical_detected" ? colors.textDim : colors.textBright };
    case "vendor": return { text: r.vendor ?? "", color: colors.text };
    case "device": return { text: r.device ?? "—", color: colors.text };
    case "date": return { text: r.date ?? "", value: r.date, color: colors.textMuted };
    case "evidence": return r.result === null ? EMPTY_TABLE_CELL
      : r.flags.includes("press_only") ? { text: "~", color: colors.textDim } : { text: "✓", color: colors.positive };
    case "notes": {
      const flags = r.flags.filter((f) => f !== "press_only").map((f) => FLAG_TEXT[f] ?? f);
      return { text: [...flags, r.context].filter(Boolean).join("; "), color: flags.length ? colors.warning : colors.textDim };
    }
    case "claimed": return r.claimedValue === null
      ? { text: "", value: null, color: colors.textDim }
      : { text: `~${formatMetric(r.unit, r.claimedValue, errorFormat)}`, value: r.claimedValue, color: colors.textDim };
  }
}

function groupLabel(group: string | null): string {
  if (!group) return "";
  if (group === "other") return "other codes";
  return MODALITY_LABELS[group] ?? CODE_FAMILY[group] ?? group.replaceAll("_", " ");
}

export function createRecordsPane({ dataset, snapshots, today = localToday }: {
  dataset: Dataset;
  snapshots: RecordsSnapshot[];
  today?: () => string;
}) {
  const resultsById = new Map(dataset.results.map((r) => [r.id, r]));
  const devicesById = new Map(dataset.devices.map((d) => [d.id, d]));
  const vendorsById = new Map(dataset.vendors.map((v) => [v.id, v]));
  const ordered = [...snapshots].sort((a, b) => a.dataset_version.localeCompare(b.dataset_version));

  function RecordsTab({ width, height, focused }: PaneProps) {
    const [lookback, setLookback] = useLookback("all");
    const errorFormat = useErrorFormat();
    const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedRecord", null);
    const [openId, setOpenId] = usePluginPaneState<string | null>("openRecord", null);
    const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);

    // Read each render so the window moves on at midnight.
    const day = effectiveToday(dataset.dataset_version, today());
    const items = useMemo(() => {
      const options = { lookback, today: day };
      const rows = recordRows(dataset, options);
      const toItem = (row: RecordReportRow): Item => ({
        kind: "record", key: `${row.metric}|${row.group ?? ""}|${row.result ?? "none"}`, row,
      });
      const disputed = disputedResults(dataset, options).map((result): Item => ({ kind: "disputed", key: `disputed|${result.id}`, result }));
      return buildSectionedRows<Item>([
        { label: "Gate model", items: rows.filter((r) => r.section === "gate").map(toItem) },
        { label: "Not comparable (non-gate)", items: rows.filter((r) => r.section === "non_gate").map(toItem) },
        { label: "Disputed (listed, not ranked)", items: disputed },
      ], (item) => item.key);
    }, [day, lookback]);

    const selectedKey = items.some((r) => r.key === selectedId) ? selectedId : items.find(isSectionedItemRow)?.key ?? null;
    const selected = items.find((r) => r.key === selectedKey);
    const resultOf = (item: Item | undefined) =>
      !item ? undefined : item.kind === "disputed" ? item.result : item.row.result ? resultsById.get(item.row.result) : undefined;
    const openResult = openId ? resultsById.get(openId) ?? null : null;
    const sourceResult = openResult ?? (selected && isSectionedItemRow(selected) ? resultOf(selected.item) : undefined);
    const { sourceIndex } = useSourceFooter({
      registrationId: PANE_IDS.records,
      focused,
      datasetVersion: dataset.dataset_version,
      sources: sourceResult?.sources ?? null,
    });

    const renderCell = useCallback((row: Row, column: Column): DataTableCell => {
      if (!isSectionedItemRow(row)) return EMPTY_TABLE_CELL;
      const item = row.item;
      if (item.kind === "disputed") {
        const device = devicesById.get(item.result.device);
        switch (column.id) {
          // The dispute note is a citation-heavy paragraph; it belongs in the record.
          case "record": return { text: "Claim under dispute (Enter for the record)", color: colors.textDim };
          case "vendor": return { text: vendorsById.get(device?.vendor ?? "")?.name ?? "", color: colors.textDim };
          case "device": return { text: device?.name ?? item.result.device, color: colors.warning };
          case "date": return { text: item.result.date_primary, color: colors.textMuted };
          case "evidence": return { text: "!", color: colors.warning };
          case "notes": return { text: "disputed", color: colors.warning };
          default: return EMPTY_TABLE_CELL;
        }
      }
      return recordItemCell(item.row, column.id, errorFormat);
    }, [errorFormat]);

    const queryBar = (
      <QueryBar
        width={width}
        filters={[{
          id: "lookback", label: "Window", inline: true, value: lookback, defaultValue: "all",
          options: LOOKBACK_VALUES.map((value) => ({ value, label: LOOKBACK_LABELS[value] })), onChange: setLookback,
        }]}
      />
    );
    const openDevice = openResult ? devicesById.get(openResult.device) : undefined;
    return (
      <DataTableStackView<Row, Column>
        focused={focused}
        detailOpen={!!openResult}
        onBack={() => setOpenId(null)}
        detailContent={openResult ? (
          <ResultDetail ref={detailScrollRef} result={openResult} dataset={dataset} errorFormat={errorFormat} width={width} sourceIndex={sourceIndex} />
        ) : null}
        detailTitle={openResult ? `${openDevice?.name ?? openResult.device} · ${openResult.date_primary}` : undefined}
        detailScrollRef={detailScrollRef}
        rootBefore={queryBar}
        rootWidth={width}
        rootHeight={height}
        columns={RECORD_COLUMNS}
        getExportMetadata={() => RECORD_EXPORT_NOTES}
        items={items}
        getItemKey={(row) => row.key}
        renderCell={renderCell}
        renderSectionHeader={renderSectionedRowHeader}
        isNavigable={isSectionedItemRow}
        selection={{ kind: "id", selectedId: selectedKey, getId: (row) => row.key, onChange: (id) => setSelectedId(id) }}
        onActivate={(row) => {
          if (!isSectionedItemRow(row)) return;
          const result = resultOf(row.item);
          if (result) setOpenId(result.id);
        }}
        sortColumnId={null}
        sortDirection="asc"
        selectedTextOverridesCellColor
        emptyStateTitle="No records in this window"
      />
    );
  }

  type ChangeColumn = DataTableColumn & { id: "record" | "change" | "before" | "after" };
  const CHANGE_COLUMNS: ChangeColumn[] = [
    { id: "record", label: "Record", width: 30, align: "left", flexGrow: 1 },
    { id: "change", label: "Change", width: 10, align: "left" },
    { id: "before", label: "Before", width: 30, align: "left" },
    { id: "after", label: "After", width: 30, align: "left" },
  ];

  function ChangesTab({ width, height, focused }: PaneProps) {
    const errorFormat = useErrorFormat();
    const [toVersion, setTo] = usePluginPaneState<string | null>("changesTo", null);
    const [fromVersion, setFrom] = usePluginPaneState<string | null>("changesFrom", null);
    const [selected, setSelected] = usePluginPaneState<number>("changesSelected", 0);
    useSourceFooter({ registrationId: PANE_IDS.records, focused, datasetVersion: dataset.dataset_version, sources: null });
    const versions = ordered.map((s) => s.dataset_version);
    const to = toVersion && versions.includes(toVersion) ? toVersion : versions[versions.length - 1];
    const before = versions.filter((v) => !to || v < to);
    const from = fromVersion && before.includes(fromVersion) ? fromVersion : before[before.length - 1];

    const changes = useMemo<RecordChange[]>(() => {
      const a = ordered.find((s) => s.dataset_version === from);
      const b = ordered.find((s) => s.dataset_version === to);
      return a && b ? diffSnapshots(a, b) : [];
    }, [from, to]);

    if (versions.length < 2 || !from || !to) {
      return (
        <EmptyState
          title="Only one dataset version so far"
          message="Changes appear here once a second curated version is published."
        />
      );
    }
    const counts = changelogCounts(dataset.changelog, from, to);
    const holderText = (holders: RecordChange["before"], metricId: string) => {
      if (holders.length === 0) return "—";
      const unit = recordUnit(metricId);
      return holders.map((h) => {
        const result = resultsById.get(h.resultId);
        const device = result ? devicesById.get(result.device)?.name : undefined;
        return `${formatMetric(unit, h.value, errorFormat)} ${device ?? h.resultId}`;
      }).join("; ");
    };
    const header = (
      <Box flexDirection="column">
        <QueryBar
          width={width}
          filters={[
            { id: "from", label: "From", value: from, options: before.map((v) => ({ value: v, label: v })), onChange: setFrom },
            { id: "to", label: "To", value: to, options: versions.slice(1).map((v) => ({ value: v, label: v })), onChange: setTo },
          ]}
        />
        <StatGrid width={width} items={[
          { label: "Results added", value: String(counts.added) },
          { label: "Updated", value: String(counts.updated) },
          { label: "Superseded", value: String(counts.superseded) },
          { label: "Retracted", value: String(counts.retracted) },
        ]} />
      </Box>
    );
    return (
      <DataTableView<RecordChange, ChangeColumn>
        focused={focused}
        rootBefore={header}
        rootWidth={width}
        rootHeight={height}
        columns={CHANGE_COLUMNS}
        items={changes}
        getItemKey={(c) => `${c.metricId}|${c.group ?? ""}`}
        renderCell={(c, column) => {
          switch (column.id) {
            case "record": {
              // Current label: a snapshot keeps the label it was written with.
              const label = LABELS.get(c.metricId) ?? c.label;
              return { text: c.group ? `${label} · ${groupLabel(c.group)}` : label, color: colors.text };
            }
            // `introduced`/`retired`: a metric defined in one version only (new, renamed or redefined).
            case "change": return { text: c.kind, color: c.kind === "removed" || c.kind === "retired" ? colors.warning : colors.positive };
            case "before": return { text: holderText(c.before, c.metricId), color: colors.textDim };
            case "after": return { text: holderText(c.after, c.metricId), color: colors.textBright };
          }
        }}
        selection={{ kind: "index", selectedIndex: Math.min(selected, Math.max(0, changes.length - 1)), onChange: (i) => setSelected(i) }}
        sortColumnId={null}
        sortDirection="asc"
        emptyStateTitle={`No records changed between ${from} and ${to}`}
      />
    );
  }

  const UNITS = new Map<string, MetricUnit>(REGISTRY.map((m) => [m.id, m.unit]));
  const LABELS = new Map<string, string>(REGISTRY.map((m) => [m.id, m.label]));
  const recordUnit = (metricId: string): MetricUnit => UNITS.get(metricId) ?? "count";

  return function RecordsPane(props: PaneProps) {
    const [tab, setTab] = usePluginPaneState<"records" | "changes">("tab", "records");
    const { strip, rows } = usePaneTabs({
      tabs: [{ value: "records", label: "Records" }, { value: "changes", label: "Changes" }],
      activeValue: tab,
      onSelect: (value) => setTab(value as "records" | "changes"),
      focused: props.focused,
      dense: true,
    });
    const body = { ...props, height: Math.max(3, props.height - rows) };
    return (
      <Box flexDirection="column" width={props.width} height={props.height}>
        {strip}
        {tab === "records" ? <RecordsTab {...body} /> : <ChangesTab {...body} />}
      </Box>
    );
  };
}
