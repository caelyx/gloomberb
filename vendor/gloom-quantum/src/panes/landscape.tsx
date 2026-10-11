// QC: programmable physical qubits against error rate, by modality, with the
// CRQC resource-estimate curves and Jaques's two boundaries (brief §6).
import { useMemo, useRef, useState } from "react";
import { CompositeChart, PageStackView, QueryBar } from "gloomberb/components";
import { usePaneSettingValue, usePluginPaneState, useShortcut } from "gloomberb/react";
import { blendHex, colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, Text, type ScrollBoxRenderable } from "gloomberb/ui";
import { LANDSCAPE_COLOURS, landscapeTone } from "../chart/palette";
import { buildLandscapeChart, type LandscapePalette, type LandscapeTarget } from "../chart/scatter-adapter";
import { fmtCount, fmtError } from "../format";
import { PANE_IDS } from "../ids";
import { estimateDetailSections } from "../model/detail";
import { buildLandscape, type YMetric } from "../model/landscape";
import { effectiveToday, LOOKBACK_VALUES, localToday } from "../model/lookback";
import type { Dataset } from "../schema";
import { DetailSections, ResultDetail } from "./detail";
import { useSourceFooter } from "./shared/footer";
import { LOOKBACK_LABELS, useErrorFormat, useLookback } from "./shared/settings";

// Legend names: the legend row holds every essential entry whole at the
// default `shot` width (1280 px, 160 cells).
// "Ion trap" and "Neut. atom" leave room for "Single pair" and "FeMoCo", both grey.
export const LEGEND_MODALITY: Record<string, string> = {
  superconducting: "Supercond.", trapped_ion: "Ion trap", neutral_atom: "Neut. atom",
  spin_semiconductor: "Spin", photonic: "Photonic", topological: "Topological", other: "Other",
};

// What the axes are and where progress points: lower error, more qubits.
const AXES_NOTE = "better ↘";

const PANELS = [{ id: "main", scale: "linear" as const }];

/** Cells the host's legend row leaves for series: a one-cell inset, then the note and a gap. */
export const legendRoom = (width: number) => width - 1 - AXES_NOTE.length - 1;

function palette(): LandscapePalette {
  // The chart's own hues (chart/palette.ts), in the form that suits the page.
  const page = /^#[0-9a-f]{6}$/i.test(colors.bg) ? colors.bg : "#000000";
  const own = LANDSCAPE_COLOURS[landscapeTone(page)];
  return {
    background: colors.bg,
    dim: colors.textDim,
    muted: colors.textMuted,
    boundary: blendHex(colors.border, colors.textDim, 0.5),
    modality: own.modality,
    rsa2048: own.rsa2048,
    ecc256: own.ecc256,
  };
}

export function createLandscapePane({ dataset, today = localToday }: { dataset: Dataset; today?: () => string }) {
  const resultsById = new Map(dataset.results.map((r) => [r.id, r]));
  const estimatesById = new Map(dataset.estimates.map((e) => [e.id, e]));

  return function LandscapePane({ width, height, focused }: PaneProps) {
    const [lookback, setLookback] = useLookback("all");
    const errorFormat = useErrorFormat();
    // Pane settings, so `gloomberb shot QC --y-metric ...` reaches them too.
    const [yMetricSetting, setYMetric] = usePaneSettingValue<string>("yMetric", "err_2q_register");
    const [showPressOnly, setShowPressOnly] = usePaneSettingValue<boolean>("showPressOnly", false);
    const [showBestPairOnly, setShowBestPairOnly] = usePaneSettingValue<boolean>("showBestPairOnly", true);
    const [openId, setOpenId] = usePluginPaneState<string | null>("openId", null);
    const [openEstimateId, setOpenEstimateId] = usePluginPaneState<string | null>("openEstimateId", null);
    const [cursorDate, setCursorDate] = useState<Date | null>(null);
    const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);
    const yMetric: YMetric = yMetricSetting === "err_worst_channel" ? "err_worst_channel" : "err_2q_register";

    const day = effectiveToday(dataset.dataset_version, today());
    const model = useMemo(() => buildLandscape(dataset, {
      yMetric, lookback, today: day, showBestPairOnly: showBestPairOnly !== false, showPressOnly: showPressOnly === true,
    }), [day, lookback, showBestPairOnly, showPressOnly, yMetric]);
    // Rebuilt every render (it is cheap): colours come from the live theme.
    const chart = buildLandscapeChart(model, {
      palette: palette(), errorFormat, modalityLabels: LEGEND_MODALITY, legendCells: legendRoom(width),
    });
    const target: LandscapeTarget | null = cursorDate ? chart.lookup(cursorDate) : null;
    const near = target?.kind === "result" ? target.point : null;
    const nearEstimate = target?.kind === "estimate" ? estimatesById.get(target.estimateId) ?? null : null;
    const openResult = openId ? resultsById.get(openId) ?? null : null;
    const openEstimate = openEstimateId ? estimatesById.get(openEstimateId) ?? null : null;
    const sourceResult = openResult ?? (near ? resultsById.get(near.resultId) : undefined);
    const sources = sourceResult?.sources ?? (openEstimate ?? nearEstimate)?.sources ?? null;
    const empty = model.points.length + model.bestPairOnly.length + model.pressOnly.length === 0;

    const info = (() => {
      if (empty) return [{ id: "empty", parts: [{ text: "no results in this window", tone: "warning" as const }] }];
      if (!target) return [];
      if (target.kind === "result") {
        const p = target.point;
        const kind = p.errorKind === "best_pair" ? " (single pair)" : p.errorKind === "worst_channel" ? " (worst channel)" : "";
        return [{ id: "cursor", parts: [
          { text: `${p.deviceName} ${p.date.slice(0, 4)}`, tone: "value" as const },
          { text: ` ${fmtCount(p.qubits)} qubits · ${fmtError(p.error, errorFormat)}${kind}`, tone: "muted" as const },
        ] }];
      }
      const bound = target.kind === "estimate" && target.qubitsUpperBound ? "≤" : "";
      return [{ id: "cursor", parts: [
        { text: target.label, tone: "value" as const },
        { text: ` ${bound}${fmtCount(target.qubits)} qubits at ${fmtError(target.error, errorFormat)}`, tone: "muted" as const },
      ] }];
    })();
    // A visible, clickable way to open the result under the cursor, for the mouse.
    const detailOpen = !!openResult || !!openEstimate;
    const openTarget = () => {
      if (near) setOpenId(near.resultId);
      else if (nearEstimate) setOpenEstimateId(nearEstimate.id);
    };
    const hints = !detailOpen && (near || nearEstimate)
      ? [{ id: "open-record", key: "Enter", label: near ? "record" : "assumptions", onPress: openTarget }]
      : [];
    const { sourceIndex } = useSourceFooter({
      registrationId: PANE_IDS.landscape,
      focused,
      datasetVersion: dataset.dataset_version,
      sources,
      info,
      hints,
    });

    // The chart's own onActivate means "the chart took focus", not "a point was
    // chosen", so Enter on the cursor's nearest result is bound here.
    useShortcut((event) => {
      if (!focused || detailOpen || !(near || nearEstimate) || event.targetEditable) return;
      if (event.name !== "return" && event.name !== "enter") return;
      if (event.ctrl || event.meta || event.shift) return;
      event.stopPropagation?.();
      event.preventDefault?.();
      openTarget();
    });

    const queryBar = (
      <QueryBar
        width={width}
        filters={[
          {
            id: "lookback", label: "Window", inline: true, value: lookback, defaultValue: "all",
            options: LOOKBACK_VALUES.map((value) => ({ value, label: LOOKBACK_LABELS[value] })), onChange: setLookback,
          },
          {
            id: "y", label: "Y", inline: true, value: yMetric,
            options: [{ value: "err_2q_register", label: "2Q register" }, { value: "err_worst_channel", label: "Worst channel" }],
            onChange: (value: string) => setYMetric(value),
          },
          {
            kind: "toggle", id: "pair", label: "Single-pair results", short: "Pairs", value: showBestPairOnly !== false,
            defaultValue: true, onChange: (value: boolean) => setShowBestPairOnly(value),
          },
          {
            kind: "toggle", id: "press", label: "Press-only claims", short: "Press", value: showPressOnly === true,
            defaultValue: false, onChange: (value: boolean) => setShowPressOnly(value),
          },
        ]}
      />
    );

    const root = (
      <Box flexDirection="column" width={width} height={height}>
        {queryBar}
        <CompositeChart
          series={chart.series}
          legendSeries={chart.legendSeries}
          panels={PANELS}
          width={width}
          height={Math.max(6, height - 1)}
          focused={focused && !detailOpen}
          navigable={false}
          showLegend
          showTimeAxis
          xAxis={chart.xAxis}
          formatAxisValue={(value) => chart.formatAxisValue(value)}
          // A scatter has no "latest value" per series: the legend names series only,
          // and the footer reads out the point under the cursor.
          formatValue={() => ""}
          onCursorDateChange={setCursorDate}
          emptyMessage="No results in this window"
          remoteKind="quantum-landscape"
          legendAccessory={<Text fg={colors.textDim}>{AXES_NOTE}</Text>}
          legendAccessoryWidth={AXES_NOTE.length}
        />
      </Box>
    );
    const openDevice = openResult ? dataset.devices.find((d) => d.id === openResult.device) : undefined;
    return (
      <PageStackView
        focused={focused}
        detailOpen={detailOpen}
        onBack={() => { setOpenId(null); setOpenEstimateId(null); }}
        rootContent={root}
        detailContent={openResult ? (
          <ResultDetail ref={detailScrollRef} result={openResult} dataset={dataset} errorFormat={errorFormat} width={width} sourceIndex={sourceIndex} />
        ) : openEstimate ? (
          <DetailSections ref={detailScrollRef} sections={estimateDetailSections(openEstimate, errorFormat)} resetKey={openEstimate.id} width={width} sourceIndex={sourceIndex} />
        ) : null}
        detailTitle={openResult ? `${openDevice?.name ?? openResult.device} · ${openResult.date_primary}` : openEstimate ? openEstimate.label ?? openEstimate.id : undefined}
      />
    );
  };
}
