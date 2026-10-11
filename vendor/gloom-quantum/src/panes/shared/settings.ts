// Settings shared by all four panes (brief §5, D16a). Both are stored once for
// the plugin, so changing them in any pane changes them everywhere; each pane
// supplies its own default for when nothing has been chosen yet (D15).
import { useEffect, useRef } from "react";
import type { PaneSettingField, PaneSettingsDef } from "gloomberb/types/plugin";
import { usePluginConfigState, usePluginPaneState } from "gloomberb/react";
import { ERROR_FORMATS, type ErrorFormat } from "../../format";
import { LOOKBACK_VALUES, parseLookback, type LookbackYears } from "../../model/lookback";

export const LOOKBACK_KEY = "lookbackYears";
export const ERROR_FORMAT_KEY = "errorFormat";

export const LOOKBACK_LABELS: Record<LookbackYears, string> = { "1": "1y", "2": "2y", "5": "5y", all: "All" };

/**
 * A pane-state value of the same key wins over the shared setting. That is
 * where `gloomberb shot`/`fn` options such as `--lookback-years` land; a
 * change made in the pane clears it, so the shared setting governs again.
 */
function useSharedSetting(key: string): [unknown, (value: string) => void] {
  const [stored, setStored] = usePluginConfigState<string | null>(key, null);
  const [override, setOverride] = usePluginPaneState<string | null>(key, null);
  // A change to the shared setting from anywhere (another pane, the settings
  // dialog) clears this pane's override, so the dialog and the pane agree.
  const lastStored = useRef(stored);
  useEffect(() => {
    if (lastStored.current === stored) return;
    lastStored.current = stored;
    if (override !== null) setOverride(null);
  }, [override, setOverride, stored]);
  return [override ?? stored, (value) => {
    setOverride(null);
    setStored(value);
  }];
}

export function useLookback(paneDefault: LookbackYears): [LookbackYears, (value: LookbackYears) => void] {
  const [value, set] = useSharedSetting(LOOKBACK_KEY);
  return [parseLookback(value, paneDefault), set];
}

export function useErrorFormat(): ErrorFormat {
  const [value] = useSharedSetting(ERROR_FORMAT_KEY);
  return (ERROR_FORMATS as readonly unknown[]).includes(value) ? (value as ErrorFormat) : "auto";
}

export const LOOKBACK_FIELD: PaneSettingField = {
  key: LOOKBACK_KEY,
  label: "Lookback",
  description: "Show results first published within this many years. Shared by all quantum panes.",
  type: "select",
  storage: "plugin",
  options: LOOKBACK_VALUES.map((value) => ({ value, label: value === "all" ? "All years" : `${value} year${value === "1" ? "" : "s"}` })),
};

export const ERROR_FORMAT_FIELD: PaneSettingField = {
  key: ERROR_FORMAT_KEY,
  label: "Error rates as",
  description: "How error rates display everywhere in the quantum panes. Exports stay raw fractions.",
  type: "select",
  storage: "plugin",
  options: [
    { value: "auto", label: "Auto", description: "Percent when it stays short, otherwise powers of ten" },
    { value: "percent", label: "Percent", description: "0.079 %" },
    { value: "exponent", label: "Powers of ten", description: "7.9×10^-4" },
    { value: "fidelity", label: "Fidelity", description: "99.921 %, as vendors quote it" },
  ],
};

/** The settings dialog for a pane: the shared fields, showing this pane's defaults when unset. */
export function paneSettings(
  lookbackDefault: LookbackYears,
  extra: { fields?: PaneSettingField[]; values?: Record<string, unknown> } = {},
): PaneSettingsDef {
  return {
    fields: [LOOKBACK_FIELD, ERROR_FORMAT_FIELD, ...(extra.fields ?? [])],
    values: { [LOOKBACK_KEY]: lookbackDefault, [ERROR_FORMAT_KEY]: "auto", ...(extra.values ?? {}) },
  };
}

export const LANDSCAPE_FIELDS: PaneSettingField[] = [
  {
    key: "yMetric",
    label: "Y axis",
    description: "Register-wide two-qubit error, or the worst reported channel (Jaques's convention).",
    type: "select",
    options: [
      { value: "err_2q_register", label: "2Q error, register-wide" },
      { value: "err_worst_channel", label: "Worst channel" },
    ],
  },
  { key: "showBestPairOnly", label: "Show single-pair results", description: "Results that report only a best-pair error, as grey points.", type: "toggle" },
  { key: "showPressOnly", label: "Show press-only claims", description: "Results backed only by a press release or vendor page, as grey points.", type: "toggle" },
];
