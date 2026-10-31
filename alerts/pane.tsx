import { useCallback, useEffect, useMemo } from "react";
import {
  Button,
  confirmDialog,
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  type DataTableCell,
  type DataTableColumn,
} from "gloomberb/components";
import { useDialog } from "gloomberb/dialog";
import { usePluginAppActions, usePluginConfigState, usePluginPaneState, usePluginTickerActions, useShortcut } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, TextAttributes, useRendererHost } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { formatDay, formatReleased, sydneyToday } from "../shared/time";
import type { FiredAlert } from "./engine";
import { describeRule, readRules, toggleRule, type AuAlertRule } from "./rules";
import { INTERVAL_OPTIONS, readIntervalMinutes } from "./service";
import { ADD_ALERT_COMMAND_ID, INTERVAL_KEY, RULES_KEY } from "./form";
import { AULRT_PANE_ID, alertTarget, checkAlertsNow, clearAlertHistory, useAlerts } from "./setup";

type View = "alerts" | "rules";
type AlertColumn = DataTableColumn & { id: "at" | "code" | "company" | "label" | "headline" };
type RuleColumn = DataTableColumn & { id: "rule" | "status" | "since" };

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "alerts", label: "Alerts" },
  { value: "rules", label: "Rules" },
];

function alertColumns(width: number): AlertColumn[] {
  // "Dividend paid in 14 days" is the longest label.
  const event = width >= 90 ? 24 : 17;
  const company = width >= 130 ? 26 : 0;
  const fixed = 12 + 7 + event + (company ? company + 1 : 0) + 6;
  return [
    { id: "at", label: "When", width: 12, align: "left" },
    { id: "code", label: "Code", width: 7, align: "left" },
    ...(company ? [{ id: "company" as const, label: "Company", width: company, align: "left" as const }] : []),
    { id: "label", label: "Event", width: event, align: "left" },
    { id: "headline", label: "Headline", width: Math.max(20, width - fixed), align: "left", flexGrow: 1 },
  ];
}

function ruleColumns(width: number): RuleColumn[] {
  return [
    { id: "rule", label: "Watching", width: Math.max(30, width - 24), align: "left", flexGrow: 1 },
    { id: "status", label: "State", width: 7, align: "left" },
    { id: "since", label: "Since", width: 12, align: "left" },
  ];
}

/** `14:05` today (Sydney), `12 Oct 14:05` on another day. */
const clock = (ms: number) => (sydneyToday(ms) === sydneyToday() ? formatReleased(ms).replace(/^\d{2} \w{3} /, "") : formatReleased(ms));

function intervalLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

/** AULRT: ASX announcement and dividend-date alerts, checked in the background. */
export function AlertsPane({ focused, width, height }: PaneProps) {
  const { history, status } = useAlerts();
  const [storedRules, setStoredRules] = usePluginConfigState<unknown>(RULES_KEY, []);
  const [storedInterval, setStoredInterval] = usePluginConfigState<string | null>(INTERVAL_KEY, null);
  const [view, setView] = usePluginPaneState<View>("view", "alerts");
  const [selectedAlert, setSelectedAlert] = usePluginPaneState<string | null>("selectedAlert", null);
  const [selectedRule, setSelectedRule] = usePluginPaneState<string | null>("selectedRule", null);
  const { openPluginCommandWorkflow } = usePluginAppActions();
  const { pinTicker } = usePluginTickerActions();
  const dialog = useDialog();
  const rendererHost = useRendererHost();
  const rules = useMemo(() => readRules(storedRules), [storedRules]);
  const interval = readIntervalMinutes(storedInterval);
  const activeRules = rules.filter((rule) => rule.status === "active").length;

  useEffect(() => {
    if (selectedAlert && history.some((alert) => alert.id === selectedAlert)) return;
    setSelectedAlert(history[0]?.id ?? null);
  }, [history, selectedAlert, setSelectedAlert]);
  useEffect(() => {
    if (selectedRule && rules.some((rule) => rule.id === selectedRule)) return;
    setSelectedRule(rules[0]?.id ?? null);
  }, [rules, selectedRule, setSelectedRule]);

  const currentAlert = history.find((alert) => alert.id === selectedAlert) ?? null;
  const currentRule = rules.find((rule) => rule.id === selectedRule) ?? null;

  const add = useCallback(() => openPluginCommandWorkflow(ADD_ALERT_COMMAND_ID), [openPluginCommandWorkflow]);
  const openAlert = useCallback((alert: FiredAlert) => {
    const target = alertTarget(alert);
    pinTicker(target.symbol, { floating: true, tabId: target.tabId });
  }, [pinTicker]);
  const openDocument = useCallback((alert: FiredAlert | null) => {
    if (alert?.documentUrl) void rendererHost.openExternal(alert.documentUrl);
  }, [rendererHost]);
  const toggle = useCallback((rule: AuAlertRule | null) => {
    if (!rule) return;
    setStoredRules((current: unknown) => readRules(current).map((entry) => (entry.id === rule.id ? toggleRule(entry) : entry)));
  }, [setStoredRules]);
  const remove = useCallback(async (rule: AuAlertRule | null) => {
    if (!rule) return;
    const confirmed = await confirmDialog(dialog, { title: "Delete ASX alert?", body: [describeRule(rule)], confirmLabel: "Delete" });
    if (confirmed) setStoredRules((current: unknown) => readRules(current).filter((entry) => entry.id !== rule.id));
  }, [dialog, setStoredRules]);
  const clear = useCallback(async () => {
    if (history.length === 0) return;
    const confirmed = await confirmDialog(dialog, {
      title: "Clear ASX alerts?",
      body: [`Removes the ${history.length} alert${history.length === 1 ? "" : "s"} listed. Rules are kept.`],
      confirmLabel: "Clear",
    });
    if (confirmed) clearAlertHistory();
  }, [dialog, history.length]);
  const cycleInterval = useCallback(() => {
    const index = (INTERVAL_OPTIONS as readonly number[]).indexOf(interval);
    setStoredInterval(String(INTERVAL_OPTIONS[(index + 1) % INTERVAL_OPTIONS.length]));
  }, [interval, setStoredInterval]);

  useShortcut((event) => {
    if (!focused || event.defaultPrevented) return;
    const handled = (() => {
      if (isPlainKey(event, "r")) return checkAlertsNow(), true;
      // As on HMA: digits pick a view, [ and ] step through them.
      if (isPlainKey(event, "1")) return setView("alerts"), true;
      if (isPlainKey(event, "2")) return setView("rules"), true;
      if (isPlainKey(event, "[", "]")) return setView(view === "alerts" ? "rules" : "alerts"), true;
      if (isPlainKey(event, "a")) return add(), true;
      if (isPlainKey(event, "i")) return cycleInterval(), true;
      if (view === "rules" && isPlainKey(event, "p")) return toggle(currentRule), true;
      if (view === "rules" && isPlainKey(event, "d")) return void remove(currentRule), true;
      if (view === "alerts" && isPlainKey(event, "o")) return openDocument(currentAlert), true;
      if (view === "alerts" && isPlainKey(event, "c")) return void clear(), true;
      return false;
    })();
    if (handled) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
  }, { enabled: focused });

  const info = useMemo(() => {
    const parts: string[] = [];
    if (status.lastCheckAt) parts.push(`checked ${clock(status.lastCheckAt)}`);
    // From the interval on screen, so changing it with i shows at once.
    const next = activeRules > 0 && status.lastCheckAt ? status.lastCheckAt + interval * 60_000 : null;
    if (next && !status.running) parts.push(next <= Date.now() ? "checking shortly" : `next ${clock(next)}`);
    parts.push(`every ${intervalLabel(interval)}`);
    parts.push(`${activeRules} active rule${activeRules === 1 ? "" : "s"}`);
    return [{ id: "aulrt", parts: [{ text: parts.join(" · "), tone: "muted" as const }] }];
  }, [activeRules, interval, status.lastCheckAt, status.running]);

  usePaneStatusFooter({
    registrationId: AULRT_PANE_ID,
    loading: status.running,
    error: status.lastError,
    info,
    hints: [
      { id: "add", key: "a", label: "dd", onPress: add },
      { id: "interval", key: "i", label: "nterval", onPress: cycleInterval },
      ...(view === "rules"
        ? [
          { id: "pause", key: "p", label: currentRule?.status === "paused" ? " resume" : "ause", onPress: () => toggle(currentRule), disabled: !currentRule },
          { id: "delete", key: "d", label: "elete", onPress: () => void remove(currentRule), disabled: !currentRule },
        ]
        : [
          { id: "open", key: "o", label: "pen PDF", onPress: () => openDocument(currentAlert), disabled: !currentAlert?.documentUrl },
          { id: "clear", key: "c", label: "lear", onPress: () => void clear(), disabled: history.length === 0 },
        ]),
    ],
  });
  usePaneNoticeFooter({ registrationId: `${AULRT_PANE_ID}:notes`, focused, notices: status.notes });

  const renderAlert = useCallback((alert: FiredAlert, column: AlertColumn): DataTableCell => {
    switch (column.id) {
      case "at": return { text: alert.kind === "dividend-date" ? formatDay(new Date(alert.at).toISOString().slice(0, 10)) : formatReleased(alert.at), value: new Date(alert.at), color: colors.textMuted };
      case "code": return { text: alert.code, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "company": return { text: alert.companyName ?? "", color: colors.textDim };
      case "label": return { text: alert.priceSensitive ? `${alert.label} *` : alert.label, color: alert.kind === "dividend-date" ? colors.positive : colors.text };
      case "headline": return { text: alert.headline, color: colors.text };
    }
  }, []);
  const renderRule = useCallback((rule: AuAlertRule, column: RuleColumn): DataTableCell => {
    const muted = rule.status === "paused";
    switch (column.id) {
      case "rule": return { text: describeRule(rule), color: muted ? colors.textMuted : colors.text };
      case "status": return { text: muted ? "Paused" : "Active", color: muted ? colors.textMuted : colors.positive };
      case "since": return { text: formatReleased(rule.createdAt), color: colors.textMuted };
    }
  }, []);

  const queryBar = (
    <QueryBar
      width={width}
      view={{ value: view, options: VIEWS, onChange: (value) => setView(value as View) }}
      meta={view === "alerts" ? `${history.length} alert${history.length === 1 ? "" : "s"}` : `${rules.length} rule${rules.length === 1 ? "" : "s"}`}
    />
  );
  const bodyHeight = Math.max(1, height - 1);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {queryBar}
      {view === "alerts" ? (
        <DataTableView<FiredAlert, AlertColumn>
          focused={focused}
          rootWidth={width}
          rootHeight={bodyHeight}
          columns={alertColumns(width)}
          items={history}
          selection={{ kind: "id", selectedId: selectedAlert, getId: (alert) => alert.id, onChange: (id) => setSelectedAlert(id) }}
          getItemKey={(alert) => alert.id}
          // Newest first, as checks add them.
          sortColumnId={null}
          sortDirection="desc"
          onActivate={openAlert}
          renderCell={renderAlert}
          selectedTextOverridesCellColor
          emptyStateTitle="No ASX alerts yet"
          emptyContent={(
            <PaneStatusBody
              empty
              emptyTitle={rules.length ? "No ASX alerts yet" : "No ASX alert rules"}
              emptyMessage={rules.length
                ? `Matching announcements and dividend dates appear here. ASX is checked every ${intervalLabel(interval)}; R checks now.`
                : "Watch for results, dividends, trading halts or any announcement, for a company, your holdings or the whole market."}
              actions={<Button label="Add ASX alert" compact onPress={add} />}
            />
          )}
        />
      ) : (
        <DataTableView<AuAlertRule, RuleColumn>
          focused={focused}
          rootWidth={width}
          rootHeight={bodyHeight}
          columns={ruleColumns(width)}
          items={rules}
          selection={{ kind: "id", selectedId: selectedRule, getId: (rule) => rule.id, onChange: (id) => setSelectedRule(id) }}
          getItemKey={(rule) => rule.id}
          sortColumnId={null}
          sortDirection="asc"
          onActivate={toggle}
          renderCell={renderRule}
          selectedTextOverridesCellColor
          emptyStateTitle="No ASX alert rules"
          emptyContent={<PaneStatusBody empty emptyTitle="No ASX alert rules" emptyMessage="Add one with a." actions={<Button label="Add ASX alert" compact onPress={add} />} />}
        />
      )}
    </Box>
  );
}
