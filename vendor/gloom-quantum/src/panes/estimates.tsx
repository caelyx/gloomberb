// QCE: CRQC resource estimates as stated, and each record-holding device's
// gap to each one, grouped by target and code assumption (brief §7, as
// amended: like for like, never a single "nearest" figure).
import { useCallback, useMemo, useRef } from "react";
import {
  buildSectionedRows,
  DataTableStackView,
  EMPTY_TABLE_CELL,
  isSectionedItemRow,
  QueryBar,
  renderSectionedRowHeader,
  usePaneTabs,
  type DataTableCell,
  type DataTableColumn,
  type SectionedRow,
} from "gloomberb/components";
import { usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, type ScrollBoxRenderable } from "gloomberb/ui";
import { fmtCount, fmtError, fmtRatio, fmtRuntime } from "../format";
import { PANE_IDS } from "../ids";
import { estimateDetailSections } from "../model/detail";
import { qubitsBasisPrefix } from "../model/estimates";
import { effectiveToday, LOOKBACK_VALUES, localToday } from "../model/lookback";
import { estimateRows, gapRows, type EstimateRow, type GapRow } from "../model/report";
import type { Dataset } from "../schema";
import { DetailSections, ResultDetail } from "./detail";
import { useSourceFooter } from "./shared/footer";
import { LOOKBACK_LABELS, useErrorFormat, useLookback } from "./shared/settings";

const TARGET: Record<string, string> = {
  rsa1024: "RSA-1024", rsa2048: "RSA-2048", rsa3072: "RSA-3072", rsa4096: "RSA-4096", ecc256: "ECC-256", femoco: "FeMoCo",
};
const CODE: Record<string, string> = { surface: "surface", qldpc: "qLDPC", other: "other code" };
const CONNECTIVITY: Record<string, string> = {
  nearest_neighbour_2d: "nearest-neighbour 2D", long_range: "long-range", reconfigurable_atoms: "reconfigurable", all_to_all: "all-to-all",
};

type EstColumn = DataTableColumn & { id: "estimate" | "target" | "code" | "connectivity" | "q3" | "q4" | "runtime" | "volume" | "date" };
const EST_COLUMNS: EstColumn[] = [
  { id: "estimate", label: "Estimate", width: 13, align: "left", flexGrow: 1 },
  { id: "target", label: "Target", width: 9, align: "left" },
  { id: "code", label: "Code", width: 8, align: "left" },
  { id: "connectivity", label: "Connectivity", width: 18, align: "left" },
  { id: "q3", label: "Qubits @1e-3", width: 13, align: "right" },
  { id: "q4", label: "Qubits @1e-4", width: 12, align: "right" },
  { id: "runtime", label: "Runtime", width: 9, align: "right" },
  { id: "volume", label: "Megaqubit-days", width: 14, align: "right" },
  { id: "date", label: "Date", width: 10, align: "left" },
];

type GapColumn = DataTableColumn & { id: "device" | "error" | "estimate" | "errorGap" | "needed" | "qubitGap" };
const GAP_COLUMNS: GapColumn[] = [
  { id: "device", label: "Device", width: 20, align: "left", flexGrow: 1 },
  { id: "error", label: "Device 2Q", width: 10, align: "right" },
  { id: "estimate", label: "Estimate", width: 22, align: "left" },
  { id: "errorGap", label: "Error gap", width: 10, align: "right" },
  { id: "needed", label: "Qubits needed", width: 14, align: "right" },
  { id: "qubitGap", label: "Qubit gap", width: 10, align: "right" },
];

export function createEstimatesPane({ dataset, today = localToday }: { dataset: Dataset; today?: () => string }) {
  const estimatesById = new Map(dataset.estimates.map((e) => [e.id, e]));
  const resultsById = new Map(dataset.results.map((r) => [r.id, r]));
  const rows = estimateRows(dataset);

  function EstimatesTab({ width, height, focused }: PaneProps) {
    const errorFormat = useErrorFormat();
    const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedEstimate", null);
    const [openId, setOpenId] = usePluginPaneState<string | null>("openEstimate", null);
    const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);
    const selected = rows.find((r) => r.estimate === selectedId) ?? rows[0];
    const open = openId ? estimatesById.get(openId) ?? null : null;
    const { sourceIndex } = useSourceFooter({
      registrationId: PANE_IDS.estimates, focused, datasetVersion: dataset.dataset_version,
      sources: (open ?? (selected ? estimatesById.get(selected.estimate) : undefined))?.sources ?? null,
    });
    const renderCell = useCallback((row: EstimateRow, column: EstColumn): DataTableCell => {
      const isBound = (key: EstimateRow["upperBounds"][number]) => row.upperBounds.includes(key);
      // A figure the paper gives as a bound exports with its "≤", not as an exact number.
      const count = (key: EstimateRow["upperBounds"][number], v: number | null): DataTableCell => v === null
        ? { text: "—" }
        : isBound(key) ? { text: `≤${fmtCount(v)}` } : { text: fmtCount(v), value: v };
      switch (column.id) {
        // The short label fits the column; the full one heads the detail.
        case "estimate": return { text: estimatesById.get(row.estimate)?.short_label ?? row.label, color: colors.textBright };
        case "target": return { text: TARGET[row.target] ?? row.target, color: colors.text };
        case "code": return { text: CODE[row.codeAssumption] ?? row.codeAssumption, color: row.codeAssumption === "surface" ? colors.text : colors.warning };
        case "connectivity": return { text: row.connectivity ? CONNECTIVITY[row.connectivity] ?? row.connectivity : "—", color: colors.textDim };
        case "q3": return count("qubitsAt1e3", row.qubitsAt1e3);
        case "q4": return count("qubitsAt1e4", row.qubitsAt1e4);
        // Runtime exports as shown ("7.4 h"): the unit is in the text.
        case "runtime": return { text: row.runtimeAt1e3 === null ? "—" : `${isBound("runtimeAt1e3") ? "≤" : ""}${fmtRuntime(row.runtimeAt1e3)}` };
        case "volume": {
          if (row.spacetimeAt1e3 === null) return { text: "—" };
          const v = Number((row.spacetimeAt1e3 / 86400 / 1e6).toPrecision(2));
          return isBound("qubitsAt1e3") || isBound("runtimeAt1e3") ? { text: `≤${v}` } : { text: String(v), value: v };
        }
        case "date": return { text: row.date, color: colors.textMuted };
      }
    }, []);
    return (
      <DataTableStackView<EstimateRow, EstColumn>
        focused={focused}
        detailOpen={!!open}
        onBack={() => setOpenId(null)}
        detailContent={open ? (
          <DetailSections ref={detailScrollRef} sections={estimateDetailSections(open, errorFormat)} resetKey={open.id} width={width} sourceIndex={sourceIndex} />
        ) : null}
        detailTitle={open ? open.label ?? open.id : undefined}
        detailScrollRef={detailScrollRef}
        rootWidth={width}
        rootHeight={height}
        columns={EST_COLUMNS}
        items={rows}
        getItemKey={(r) => r.estimate}
        renderCell={renderCell}
        selection={{ kind: "id", selectedId: selected?.estimate ?? null, getId: (r) => r.estimate, onChange: (id) => setSelectedId(id) }}
        onActivate={(r) => setOpenId(r.estimate)}
        sortColumnId={null}
        sortDirection="asc"
        selectedTextOverridesCellColor
        emptyStateTitle="No estimates in the dataset"
      />
    );
  }

  type GapRowItem = SectionedRow<GapRow>;
  const gapKey = (g: GapRow) => `${g.estimate}|${g.result}`;

  function GapsTab({ width, height, focused }: PaneProps) {
    const [lookback, setLookback] = useLookback("all");
    // Read each render so the window moves on at midnight.
    const day = effectiveToday(dataset.dataset_version, today());
    const errorFormat = useErrorFormat();
    const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedGap", null);
    const [openId, setOpenId] = usePluginPaneState<string | null>("openGapResult", null);
    const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);
    const items = useMemo(() => {
      const gaps = gapRows(dataset, { lookback, today: day });
      const groups = new Map<string, GapRow[]>();
      for (const g of gaps) {
        const label = `${TARGET[g.target] ?? g.target} · ${CODE[g.codeAssumption] ?? g.codeAssumption}`;
        groups.set(label, [...(groups.get(label) ?? []), g]);
      }
      return buildSectionedRows([...groups.entries()].map(([label, list]) => ({ label, items: list })), gapKey);
    }, [day, lookback]);
    const selectedKey = items.some((r) => r.key === selectedId) ? selectedId : items.find(isSectionedItemRow)?.key ?? null;
    const selected = items.find((r) => r.key === selectedKey);
    const open = openId ? resultsById.get(openId) ?? null : null;
    const sourceResult = open ?? (selected && isSectionedItemRow(selected) ? resultsById.get(selected.item.result) : undefined);
    const { sourceIndex } = useSourceFooter({
      registrationId: PANE_IDS.estimates, focused, datasetVersion: dataset.dataset_version, sources: sourceResult?.sources ?? null,
    });
    const renderCell = useCallback((row: GapRowItem, column: GapColumn): DataTableCell => {
      if (!isSectionedItemRow(row)) return EMPTY_TABLE_CELL;
      const g = row.item;
      switch (column.id) {
        case "device": return { text: g.device, color: colors.textBright };
        case "error": return { text: fmtError(g.deviceError, errorFormat), value: g.deviceError };
        // Marked by code as well as sectioned, so an exported row is still like for like.
        case "estimate": {
          const e = estimatesById.get(g.estimate);
          const code = g.codeAssumption === "surface" ? "" : ` (${CODE[g.codeAssumption] ?? g.codeAssumption})`;
          return { text: `${e?.short_label ?? e?.label ?? g.estimate}${code}`, color: colors.textDim };
        }
        case "errorGap": return { text: fmtRatio(g.errorGap), value: Number(g.errorGap.toPrecision(2)), color: g.errorGap <= 1 ? colors.positive : colors.warning };
        case "needed": {
          if (g.qubitsNeeded === null) return { text: "n/a", value: null, color: colors.textDim };
          const prefix = qubitsBasisPrefix(g.qubitsBasis);
          const shown = g.qubitsBasis === "interpolated" ? Number(g.qubitsNeeded.toPrecision(2)) : g.qubitsNeeded;
          return prefix ? { text: `${prefix}${fmtCount(shown)}` } : { text: fmtCount(shown), value: shown };
        }
        case "qubitGap": {
          // A gap computed from a bounded or interpolated count is bounded or approximate too.
          if (g.qubitGap === null) return { text: "—", color: colors.textDim };
          const prefix = qubitsBasisPrefix(g.qubitsBasis);
          const text = `${prefix}${fmtRatio(g.qubitGap)}`;
          return prefix ? { text, color: colors.text } : { text, value: Number(g.qubitGap.toPrecision(2)), color: colors.text };
        }
      }
    }, [errorFormat]);
    const openDevice = open ? dataset.devices.find((d) => d.id === open.device) : undefined;
    return (
      <DataTableStackView<GapRowItem, GapColumn>
        focused={focused}
        detailOpen={!!open}
        onBack={() => setOpenId(null)}
        detailContent={open ? (
          <ResultDetail ref={detailScrollRef} result={open} dataset={dataset} errorFormat={errorFormat} width={width} sourceIndex={sourceIndex} />
        ) : null}
        detailTitle={open ? `${openDevice?.name ?? open.device} · ${open.date_primary}` : undefined}
        detailScrollRef={detailScrollRef}
        // The devices compared are those holding a record in this window.
        rootBefore={
          <QueryBar
            width={width}
            filters={[{
              id: "lookback", label: "Devices from", inline: true, value: lookback, defaultValue: "all",
              options: LOOKBACK_VALUES.map((value) => ({ value, label: LOOKBACK_LABELS[value] })), onChange: setLookback,
            }]}
          />
        }
        rootWidth={width}
        rootHeight={height}
        columns={GAP_COLUMNS}
        items={items}
        getItemKey={(r) => r.key}
        renderCell={renderCell}
        renderSectionHeader={renderSectionedRowHeader}
        isNavigable={isSectionedItemRow}
        selection={{ kind: "id", selectedId: selectedKey, getId: (r) => r.key, onChange: (id) => setSelectedId(id) }}
        onActivate={(r) => { if (isSectionedItemRow(r)) setOpenId(r.item.result); }}
        sortColumnId={null}
        sortDirection="asc"
        selectedTextOverridesCellColor
        emptyStateTitle={`No record-holding device reports a register-wide 2Q error${lookback === "all" ? "" : ` in the last ${lookback === "1" ? "year" : `${lookback} years`}`}`}
      />
    );
  }

  return function EstimatesPane(props: PaneProps) {
    const [tab, setTab] = usePluginPaneState<"estimates" | "gaps">("tab", "estimates");
    const { strip, rows: tabRows } = usePaneTabs({
      tabs: [{ value: "estimates", label: "Estimates" }, { value: "gaps", label: "Gaps" }],
      activeValue: tab,
      onSelect: (value) => setTab(value as "estimates" | "gaps"),
      focused: props.focused,
      dense: true,
    });
    const body = { ...props, height: Math.max(3, props.height - tabRows) };
    return (
      <Box flexDirection="column" width={props.width} height={props.height}>
        {strip}
        {tab === "estimates" ? <EstimatesTab {...body} /> : <GapsTab {...body} />}
      </Box>
    );
  };
}

