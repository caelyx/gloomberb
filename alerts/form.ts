import type { CommandShortcutArgContext, WizardStep } from "gloomberb/types/plugin";
import { parsePublicTickerKey } from "gloomberb/utils";
import { asxCodeFromSymbol } from "../shared/asx";
import { EVENT_LABELS, SCOPE_LABELS, type AlertEvent } from "./rules";
import { DEFAULT_INTERVAL_MINUTES, INTERVAL_OPTIONS } from "./service";

/** The Add ASX Alert form, its shortcut argument, and the interval setting. */

export const ADD_ALERT_COMMAND_ID = "au-markets:add-alert";
/** Mirrors core's `SA` (set alert): `AUSA BHP`. */
export const ADD_ALERT_SHORTCUT = "AUSA";
/** The rules, in the plugin's config state. */
export const RULES_KEY = "auAlertRules";
/** Minutes between checks, as a string (the plugin settings form's select). */
export const INTERVAL_KEY = "auAlertsIntervalMinutes";

export const INTERVAL_FIELD = {
  key: INTERVAL_KEY,
  label: "ASX alerts (AULRT) check interval",
  type: "select" as const,
  required: false,
  defaultValue: String(DEFAULT_INTERVAL_MINUTES),
  description: "How often AULRT reads ASX's announcement feed while Gloomberb is open. R in the AULRT pane checks at once.",
  options: INTERVAL_OPTIONS.map((minutes) => ({ value: String(minutes), label: minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : `${minutes / 60} hours` })),
};

const EVENT_ORDER: AlertEvent[] = ["results", "dividend", "dividend-dates", "halt", "any"];

export const ADD_ALERT_WIZARD: WizardStep[] = [
  { key: "event", label: "Watch for", type: "select", defaultValue: "halt", options: EVENT_ORDER.map((value) => ({ value, label: EVENT_LABELS[value] })) },
  { key: "scope", label: "From", type: "select", defaultValue: "ticker", options: (["ticker", "watched", "market"] as const).map((value) => ({ value, label: SCOPE_LABELS[value] })) },
  { key: "code", label: "ASX code", placeholder: "BHP", type: "text", required: true, dependsOn: { key: "scope", value: "ticker" } },
  {
    key: "priceSensitive", label: "Price-sensitive only (announcements)", type: "select", defaultValue: "no",
    options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
  },
  { key: "keyword", label: "Headline contains (announcements, optional)", placeholder: "offtake", type: "text", required: false },
  {
    key: "dates", label: "Dates", type: "select", defaultValue: "ex", dependsOn: { key: "event", value: "dividend-dates" },
    options: [
      { value: "ex", label: "Ex-date" },
      { value: "ex,pay", label: "Ex-date and pay date" },
      { value: "pay", label: "Pay date" },
      { value: "all", label: "Ex, record and pay dates" },
    ],
  },
  { key: "leadDays", label: "Days ahead (0 to 14)", placeholder: "1", defaultValue: "1", type: "number", dependsOn: { key: "event", value: "dividend-dates" } },
];

/**
 * `AUSA BHP` opens the form for BHP; plain `AUSA` (or the command from the bar)
 * for the active ticker when it is an ASX listing. A typed code is read as
 * ASX's, as ASXA reads it.
 */
export function parseAddAlertArg(arg: string, context: CommandShortcutArgContext): Record<string, string> {
  const typed = arg.trim().toUpperCase();
  const code = typed
    ? asxCodeFromSymbol(typed) ?? asxCodeFromSymbol(parsePublicTickerKey(typed).symbol, "ASX")
    : asxCodeFromSymbol(context.activeTicker);
  return code ? { scope: "ticker", code } : {};
}
