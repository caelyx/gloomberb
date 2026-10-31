import { useSyncExternalStore } from "react";
import type { GloomPluginContext } from "gloomberb/types/plugin";
import { fetchMarketFeedPage } from "../announcements/client";
import { ANNOUNCEMENTS_TAB_ID } from "../announcements/pane";
import { loadFranking, loadFrankingWithin } from "../franking/client";
import { loadAsxDirectory, searchAsx } from "../directory/client";
import { FRANKING_TAB_ID } from "../franking/command";
import { asxCodeForTicker } from "../shared/asx";
import type { FiredAlert } from "./engine";
import { ADD_ALERT_COMMAND_ID, ADD_ALERT_SHORTCUT, ADD_ALERT_WIZARD, INTERVAL_KEY, RULES_KEY, parseAddAlertArg } from "./form";
import { createRule, readRules } from "./rules";
import { createAlertService, readIntervalMinutes, type AlertService, type AlertsSnapshot } from "./service";

export const AULRT_PANE_ID = "au-alerts";
export const AULRT_TEMPLATE_ID = "au-alerts-pane";
/** Dividend dates are re-read at most daily, unless the feed shows a new dividend for the company. */
const DIVIDEND_MAX_AGE_MS = 24 * 60 * 60_000;

let service: AlertService | null = null;
let unwatchService: (() => void) | null = null;

const EMPTY_SNAPSHOT: AlertsSnapshot = {
  history: [],
  status: { running: false, lastCheckAt: null, nextCheckAt: null, lastError: null, notes: [] },
};
// Panes subscribe here rather than to a service, so an open pane follows the
// service a plugin re-setup (toggled off and on) puts in place.
const listeners = new Set<() => void>();
const notifyListeners = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => service?.getSnapshot() ?? EMPTY_SNAPSHOT;

function setService(next: AlertService | null): void {
  unwatchService?.();
  service = next;
  unwatchService = next ? next.subscribe(notifyListeners) : null;
  notifyListeners();
}

/** The pane's view of the service: alerts so far and the check status. */
export function useAlerts(): AlertsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The pane's R key. */
export function checkAlertsNow(): void {
  void service?.checkNow();
}

/** The pane's c key. */
export function clearAlertHistory(): void {
  service?.clearHistory();
}

/** Ticker Research on the tab the alert is about. */
export function alertTarget(alert: FiredAlert): { symbol: string; tabId: string } {
  return { symbol: `${alert.code}.AX`, tabId: alert.kind === "dividend-date" ? FRANKING_TAB_ID : ANNOUNCEMENTS_TAB_ID };
}

/**
 * A mistyped code would never fire. ASX's search knows companies, ETFs and
 * funds but not hybrids, whose announcements are lodged under the issuer's code
 * (CBAPJ's suspension came under CBA), so a code it does not know is worth a
 * warning either way. Silent when the search itself fails.
 */
async function warnIfUnknown(ctx: GloomPluginContext, code: string): Promise<void> {
  try {
    const matches = await searchAsx(code);
    if (matches.some((match) => match.code === code)) return;
    ctx.notify({ body: `ASX search does not know ${code}, so this alert may never fire. Check the code; for a hybrid, use the issuer's code (CBA, not CBAPK).`, type: "info" });
  } catch {
    // No answer is not evidence of a wrong code.
  }
}

/** The AULRT background checks and the Add ASX Alert command. Returns the disposer. */
export function setupAlerts(ctx: GloomPluginContext): () => void {
  service?.stop();
  const current = createAlertService({
    readRules: () => readRules(ctx.configState.get(RULES_KEY)),
    readIntervalMinutes: () => readIntervalMinutes(ctx.configState.get(INTERVAL_KEY)),
    persistence: ctx.persistence,
    notify: (notice) => { ctx.notify(notice); },
    openAlert: (alert) => {
      const target = alertTarget(alert);
      ctx.pinTicker(target.symbol, { floating: true, tabId: target.tabId });
    },
    openPane: () => ctx.createPaneFromTemplate(AULRT_TEMPLATE_ID),
    fetchPage: fetchMarketFeedPage,
    loadDividend: (code, refresh, signal) => (refresh ? loadFranking(code, { force: true, signal }) : loadFrankingWithin(code, DIVIDEND_MAX_AGE_MS, { signal })),
    watchedCodes: async () => {
      const tickers = await ctx.tickerRepository.loadAllTickers();
      const codes = new Set<string>();
      for (const ticker of tickers) {
        if (!ticker.metadata.watchlists.length && !ticker.metadata.portfolios.length) continue;
        const code = asxCodeForTicker(ticker);
        if (code) codes.add(code);
      }
      return codes;
    },
    companyNames: async () => new Map((await loadAsxDirectory()).map((company) => [company.code, company.name])),
    log: ctx.log,
  });
  setService(current);

  ctx.registerCommand({
    id: ADD_ALERT_COMMAND_ID,
    label: "Add ASX Alert",
    description: "Alert on ASX announcements (results, dividends, trading halts, any) or coming dividend dates, for a company, your holdings or the market",
    keywords: ["alert", "asx", "aulrt", "announcement", "trading halt", "halt", "dividend", "ex-dividend", "earnings", "results", "notify", "australia"],
    category: "data",
    shortcut: ADD_ALERT_SHORTCUT,
    shortcutArg: { placeholder: "ASX code", kind: "ticker", parse: parseAddAlertArg },
    wizard: ADD_ALERT_WIZARD,
    async execute(values = {}) {
      const rules = readRules(ctx.configState.get(RULES_KEY));
      const rule = createRule(values, rules);
      await ctx.configState.set(RULES_KEY, [...rules, rule]);
      ctx.notify({ body: "ASX alert saved. AULRT lists it under Rules.", type: "success" });
      // A dividend date may already be due; announcements wait for the next check, which reads back to the rule's creation.
      if (rule.event === "dividend-dates") void current.checkNow();
      if (rule.code) void warnIfUnknown(ctx, rule.code);
    },
  });

  current.start();
  return () => {
    current.stop();
    if (service === current) setService(null);
  };
}
