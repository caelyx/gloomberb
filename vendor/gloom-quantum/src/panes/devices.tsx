// QCD: every hardware result in the lookback window, by modality (brief §7).
import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildSectionedRows,
  DataTableStackView,
  EMPTY_TABLE_CELL,
  isSectionedItemRow,
  QueryBar,
  renderSectionedRowHeader,
  type DataTableCell,
  type DataTableColumn,
  type SectionedRow,
} from "gloomberb/components";
import { usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import type { ScrollBoxRenderable } from "gloomberb/ui";
import { nextHeaderSort, type SortPreference } from "gloomberb/utils";
import { fmtCount, fmtError } from "../format";
import { PANE_IDS } from "../ids";
import { effectiveToday, LOOKBACK_VALUES, localToday } from "../model/lookback";
import {
  deviceRows,
  filterDeviceRows,
  OUT_OF_SCOPE_SECTION,
  sectionDeviceRows,
  type DeviceRow,
  type DeviceSortColumn,
} from "../model/report";
import { MODALITY_LABELS } from "../model/registry";
import type { Dataset } from "../schema";
import { ResultDetail } from "./detail";
import { useSourceFooter } from "./shared/footer";
import { LOOKBACK_LABELS, useErrorFormat, useLookback } from "./shared/settings";

type Column = DataTableColumn & { id: DeviceSortColumn };
type Row = SectionedRow<DeviceRow>;

export { MODALITY_LABELS };

/**
 * Annealers are shown, but apart: they cannot run Shor's algorithm, so they are no cryptanalytic
 * threat measure (data/README.md rule 20).
 */
export const OUT_OF_SCOPE_LABEL = "Annealing (out of scope: cannot run Shor)";

const sectionLabel = (section: string) =>
  section === OUT_OF_SCOPE_SECTION ? OUT_OF_SCOPE_LABEL : MODALITY_LABELS[section] ?? section;

/**
 * A non-programmable count names what it counts; "fab." is a fabricated count never shown operable,
 * "ann." an annealer's qubits (its section says it is out of scope).
 */
const UNIT_SHORT: Record<string, string> = { fabricated: "fab.", annealing: "ann.", analog: "analogue" };

const DEFAULT_SORT: SortPreference<DeviceSortColumn> = { columnId: "date", direction: "desc" };

function columns(errorHeader: string): Column[] {
  return [
    { id: "date", label: "Date", width: 10, align: "left" },
    { id: "vendor", label: "Vendor", width: 14, align: "left" },
    { id: "device", label: "Device", width: 22, align: "left", flexGrow: 1 },
    { id: "qubits", label: "Qubits", width: 11, align: "right" },
    { id: "err2q", label: errorHeader, width: 12, align: "right" },
    { id: "logical", label: "Logical c/d", width: 11, align: "right" },
    { id: "lambda", label: "Λ", width: 5, align: "right" },
    { id: "codes", label: "Codes", width: 16, align: "left" },
    { id: "evidence", label: "Ev", width: 2, align: "left" },
  ];
}

function lookbackPhrase(years: string): string {
  return years === "1" ? "the last year" : `the last ${years} years`;
}

export function createDevicesPane({ dataset, today = localToday }: { dataset: Dataset; today?: () => string }) {
  const resultsById = new Map(dataset.results.map((r) => [r.id, r]));
  const modalityOptions = [...new Set(dataset.devices.map((d) => d.modality))]
    .map((value) => ({ value, label: MODALITY_LABELS[value] ?? value }));

  return function DevicesPane({ width, height, focused }: PaneProps) {
    const [lookback, setLookback] = useLookback("5");
    const errorFormat = useErrorFormat();
    const [verifiedOnly, setVerifiedOnly] = usePluginPaneState("verifiedOnly", false);
    const [modalities, setModalities] = usePluginPaneState<string[]>("modalities", []);
    const [sort, setSort] = useState<SortPreference<DeviceSortColumn>>(DEFAULT_SORT);
    const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedId", null);
    const [openId, setOpenId] = usePluginPaneState<string | null>("openId", null);
    const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);

    // Read each render so the window moves on at midnight.
    const day = effectiveToday(dataset.dataset_version, today());
    const sections = useMemo(() => {
      const rows = filterDeviceRows(deviceRows(dataset, { lookback, today: day }), { verifiedOnly, modalities });
      return sectionDeviceRows(rows, { columnId: sort.columnId ?? "date", direction: sort.direction });
    }, [day, lookback, modalities, sort, verifiedOnly]);
    const items = useMemo(() => buildSectionedRows(
      sections.map((s) => ({ label: sectionLabel(s.section), items: s.rows })),
      (row) => row.result,
    ), [sections]);

    const firstItem = items.find(isSectionedItemRow);
    const selectedKey = items.some((r) => r.key === selectedId) ? selectedId : firstItem?.key ?? null;
    const selectedRow = items.find((r) => r.key === selectedKey);
    const openResult = openId ? resultsById.get(openId) ?? null : null;
    const sourceResult = openResult ?? (selectedRow && isSectionedItemRow(selectedRow) ? resultsById.get(selectedRow.item.result) : undefined);

    const hints = useMemo(() => openResult ? [] : [{
      id: "verified", key: "v", label: verifiedOnly ? "all results" : "verified only",
      onPress: () => setVerifiedOnly(!verifiedOnly),
    }], [openResult, setVerifiedOnly, verifiedOnly]);
    const { sourceIndex } = useSourceFooter({
      registrationId: PANE_IDS.devices,
      focused,
      datasetVersion: dataset.dataset_version,
      sources: sourceResult?.sources ?? null,
      hints,
    });

    const filtered = verifiedOnly || modalities.length > 0;
    const errorHeader = errorFormat === "fidelity" ? "2Q fidelity" : "2Q error";
    const cols = useMemo(() => columns(errorHeader), [errorHeader]);

    const renderCell = useCallback((row: Row, column: Column): DataTableCell => {
      if (!isSectionedItemRow(row)) return EMPTY_TABLE_CELL;
      const r = row.item;
      const dim = r.evidence === "press_only" || r.status === "disputed";
      const fg = dim ? colors.textDim : colors.text;
      switch (column.id) {
        case "date": return { text: r.date, value: r.date, color: colors.textMuted };
        case "vendor": return { text: r.vendor, color: fg };
        case "device": return { text: r.device, color: dim ? colors.textDim : colors.textBright };
        // CSV export writes a cell's `value` in place of its text, so a value is
        // given only where the number means exactly what the column says.
        case "qubits":
          return r.qubits !== null
            ? { text: fmtCount(r.qubits), value: r.qubits, color: fg }
            : { text: r.otherCount ? `${fmtCount(r.otherCount.value)} ${UNIT_SHORT[r.otherCount.unit] ?? r.otherCount.unit}` : "—",
              color: colors.textDim };
        case "err2q": {
          if (r.err2q === null) return { text: "—", color: fg };
          const text = fmtError(r.err2q, errorFormat);
          // A single-pair or isolated-RB error keeps its mark in the export; the column means register-wide.
          if (r.err2qBasis === "best_pair") return { text: `${text} *`, color: fg };
          if (r.err2qBasis === "isolated") return { text: `${text} iso`, color: fg };
          return { text, value: errorFormat === "fidelity" ? 1 - r.err2q : r.err2q, color: fg };
        }
        case "logical": {
          // Spaced so a spreadsheet never reads "3/5" as a date.
          const text = r.logicalCorrected === null && r.logicalDetected === null
            ? "—" : `${r.logicalCorrected ?? "—"} / ${r.logicalDetected ?? "—"}`;
          return { text, color: fg };
        }
        case "lambda": return { text: r.lambda === null ? "—" : String(r.lambda), value: r.lambda, color: fg };
        case "codes": return { text: r.codes, color: colors.textDim };
        case "evidence": {
          const glyph = r.status === "disputed" ? "!" : r.evidence === "press_only" ? "~" : "✓";
          return { text: glyph, color: r.status === "disputed" ? colors.warning : r.evidence === "press_only" ? colors.textDim : colors.positive };
        }
      }
    }, [errorFormat]);

    const queryBar = (
      <QueryBar
        width={width}
        filters={[
          {
            id: "lookback", label: "Window", inline: true, value: lookback, defaultValue: "5",
            options: LOOKBACK_VALUES.map((value) => ({ value, label: LOOKBACK_LABELS[value] })),
            onChange: setLookback,
          },
          {
            kind: "multi", id: "modalities", label: "Modality", values: modalities, options: modalityOptions,
            onChange: setModalities, emptyLabel: "All",
          },
          {
            kind: "toggle", id: "verified", label: "Verified only", short: "Verified", value: verifiedOnly,
            defaultValue: false, onChange: setVerifiedOnly,
          },
        ]}
      />
    );

    const detail = openResult ? (
      <ResultDetail
        ref={detailScrollRef}
        result={openResult}
        dataset={dataset}
        errorFormat={errorFormat}
        width={width}
        sourceIndex={sourceIndex}
      />
    ) : null;
    const openDevice = openResult ? dataset.devices.find((d) => d.id === openResult.device) : undefined;

    return (
      <DataTableStackView<Row, Column>
        focused={focused}
        detailOpen={!!openResult}
        onBack={() => setOpenId(null)}
        detailContent={detail}
        detailTitle={openResult ? `${openDevice?.name ?? openResult.device} · ${openResult.date_primary}` : undefined}
        detailScrollRef={detailScrollRef}
        rootBefore={queryBar}
        rootWidth={width}
        rootHeight={height}
        columns={cols}
        items={items}
        getItemKey={(row) => row.key}
        renderCell={renderCell}
        renderSectionHeader={renderSectionedRowHeader}
        isNavigable={isSectionedItemRow}
        selection={{
          kind: "id",
          selectedId: selectedKey,
          getId: (row) => row.key,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={(row) => { if (isSectionedItemRow(row)) setOpenId(row.item.result); }}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(id) => setSort((current) => nextHeaderSort(current, id as DeviceSortColumn, {
          firstDirection: id === "date" || id === "qubits" || id === "lambda" || id === "logical" ? "desc" : "asc",
          resetTo: DEFAULT_SORT,
        }))}
        selectedTextOverridesCellColor
        emptyStateTitle={filtered
          ? `No ${[verifiedOnly ? "verified" : "", modalities.map((m) => MODALITY_LABELS[m]?.toLowerCase() ?? m).join(" or ")].filter(Boolean).join(" ")} results in ${lookbackPhrase(lookback)}`
          : `No results in ${lookbackPhrase(lookback)}`}
        emptyStateHint={filtered ? "Clear the filters above, or widen the window." : lookback === "all" ? undefined : "Widen the window above."}
      />
    );
  };
}
