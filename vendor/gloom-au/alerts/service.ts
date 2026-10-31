import type { AsxAnnouncement } from "../announcements/model";
import type { FrankingSnapshot } from "../franking/model";
import type { AppNotificationRequest, PluginPersistence } from "gloomberb/types/plugin";
import { EMPTY_STATE, runCheck, type AlertState, type FiredAlert } from "./engine";
import type { AuAlertRule } from "./rules";

/**
 * Runs AULRT checks in the background while Gloomberb is open. A one-minute
 * tick only compares clocks; ASX is asked only when the interval (an hour by
 * default) has passed since the last check, which is saved, so restarting the
 * app does not check early. `checkNow` is the pane's `R` key.
 */

export const INTERVAL_OPTIONS = [15, 30, 60, 120, 240] as const;
export const DEFAULT_INTERVAL_MINUTES = 60;
/** Enough that a busy rule does not push another's alerts out within days. */
export const MAX_HISTORY = 500;
/** One notification each up to this many alerts in a check; more become one summary. */
const MAX_SINGLE_NOTICES = 3;
const STATE_KEY = "au-alerts:state";
const HISTORY_KEY = "au-alerts:history";
const SCHEMA_VERSION = 1;
const TICK_MS = 60_000;

export function readIntervalMinutes(value: unknown): number {
  const minutes = Number(value);
  return (INTERVAL_OPTIONS as readonly number[]).includes(minutes) ? minutes : DEFAULT_INTERVAL_MINUTES;
}

export interface AlertStatus {
  running: boolean;
  lastCheckAt: number | null;
  /** Null when no rule is active. */
  nextCheckAt: number | null;
  lastError: string | null;
  notes: string[];
}

export interface AlertsSnapshot {
  history: FiredAlert[];
  status: AlertStatus;
}

export interface ServiceDeps {
  readRules(): AuAlertRule[];
  readIntervalMinutes(): number;
  persistence: Pick<PluginPersistence, "getState" | "setState">;
  notify(notice: AppNotificationRequest): void;
  openAlert(alert: FiredAlert): void;
  openPane(): void;
  fetchPage(page: number, signal?: AbortSignal): Promise<AsxAnnouncement[]>;
  loadDividend(code: string, refresh: boolean, signal?: AbortSignal): Promise<FrankingSnapshot>;
  watchedCodes(): Promise<Set<string>>;
  /** Company names by ASX code, for notifications. Optional and best effort. */
  companyNames?(): Promise<ReadonlyMap<string, string>>;
  log?: { info(message: string, data?: unknown): void; warn(message: string, data?: unknown): void };
  now?: () => number;
}

export interface AlertService {
  start(): void;
  stop(): void;
  /** Compares clocks and checks if one is due. */
  tick(): Promise<void>;
  /** Checks at once; joins a check already running. */
  checkNow(): Promise<void>;
  /** Empties the Alerts list. Rules and the feed position are kept. */
  clearHistory(): void;
  getSnapshot(): AlertsSnapshot;
  subscribe(listener: () => void): () => void;
}

function readState(stored: unknown): AlertState {
  const raw = stored as Partial<AlertState> | null;
  if (!raw || typeof raw !== "object") return EMPTY_STATE;
  const cursor = raw.cursor && typeof raw.cursor.latest === "number" && Array.isArray(raw.cursor.seen)
    ? { latest: raw.cursor.latest, seen: raw.cursor.seen.filter((id): id is string => typeof id === "string") }
    : null;
  return {
    cursor,
    firedKeys: Array.isArray(raw.firedKeys) ? raw.firedKeys.filter((key): key is string => typeof key === "string") : [],
    lastCheckAt: typeof raw.lastCheckAt === "number" && Number.isFinite(raw.lastCheckAt) ? raw.lastCheckAt : null,
  };
}

function readHistory(stored: unknown): FiredAlert[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry): entry is FiredAlert => (
    !!entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.code === "string"
    && typeof entry.label === "string" && typeof entry.headline === "string" && typeof entry.at === "number"
    && typeof entry.firedAt === "number" && (entry.kind === "announcement" || entry.kind === "dividend-date")
    && Array.isArray(entry.ruleIds) && (entry.companyName === undefined || typeof entry.companyName === "string")
  ));
}

export function createAlertService(deps: ServiceDeps): AlertService {
  const now = deps.now ?? Date.now;
  let state = readState(deps.persistence.getState(STATE_KEY, { schemaVersion: SCHEMA_VERSION }));
  let history = readHistory(deps.persistence.getState(HISTORY_KEY, { schemaVersion: SCHEMA_VERSION }));
  let status: AlertStatus = {
    running: false, lastCheckAt: state.lastCheckAt, nextCheckAt: null, lastError: null, notes: [],
  };
  let snapshot: AlertsSnapshot = { history, status };
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const emit = () => {
    snapshot = { history, status };
    for (const listener of listeners) listener();
  };
  const hasActiveRules = () => {
    try {
      return deps.readRules().some((rule) => rule.status === "active");
    } catch {
      return false;
    }
  };
  const refreshSchedule = () => {
    const current = now();
    // A last check dated ahead of the clock (the clock was put back) counts as no check, or none would come for days.
    const last = state.lastCheckAt != null && state.lastCheckAt <= current + 60_000 ? state.lastCheckAt : null;
    const nextCheckAt = !hasActiveRules() ? null : last == null ? current : last + deps.readIntervalMinutes() * 60_000;
    if (nextCheckAt !== status.nextCheckAt) {
      status = { ...status, nextCheckAt };
      emit();
    }
    return nextCheckAt;
  };

  const notifyFired = (fired: FiredAlert[]) => {
    if (fired.length === 0) return;
    if (fired.length <= MAX_SINGLE_NOTICES) {
      for (const alert of fired) {
        deps.notify({
          title: alert.companyName ? `ASX alert · ${alert.code} · ${alert.companyName}` : `ASX alert · ${alert.code}`,
          body: `${alert.label}: ${alert.headline}`,
          type: "info",
          desktop: "when-inactive",
          action: { label: "Open", onClick: () => deps.openAlert(alert) },
        });
      }
      return;
    }
    const shown = fired.slice(0, 4).map((alert) => `${alert.code} ${alert.label}`);
    const rest = fired.length - shown.length;
    deps.notify({
      title: `${fired.length} ASX alerts`,
      body: rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", "),
      type: "info",
      desktop: "when-inactive",
      action: { label: "Open AULRT", onClick: () => deps.openPane() },
    });
  };

  const run = async () => {
    controller = new AbortController();
    const signal = controller.signal;
    status = { ...status, running: true };
    emit();
    try {
      const result = await runCheck({
        now: now(),
        rules: deps.readRules(),
        state,
        fetchPage: (page) => deps.fetchPage(page, signal),
        loadDividend: (code, refresh) => deps.loadDividend(code, refresh, signal),
        watchedCodes: deps.watchedCodes,
      });
      if (stopped) return;
      state = result.state;
      const known = new Set(history.map((alert) => alert.id));
      const fresh = result.fired.filter((alert) => !known.has(alert.id));
      if (fresh.length > 0 && deps.companyNames) {
        try {
          const names = await deps.companyNames();
          for (const alert of fresh) {
            const name = names.get(alert.code);
            if (name) alert.companyName = name;
          }
        } catch (error) {
          deps.log?.warn("AULRT: no company names", { error: error instanceof Error ? error.message : String(error) });
        }
      }
      history = [...fresh, ...history].slice(0, MAX_HISTORY);
      deps.persistence.setState(STATE_KEY, state, { schemaVersion: SCHEMA_VERSION });
      deps.persistence.setState(HISTORY_KEY, history, { schemaVersion: SCHEMA_VERSION });
      status = { ...status, lastCheckAt: state.lastCheckAt, lastError: result.errors.length ? result.errors.join("; ") : null, notes: result.notes };
      if (result.errors.length) deps.log?.warn("AULRT check had errors", { errors: result.errors });
      deps.log?.info("AULRT check", { pages: result.pages, fired: fresh.length });
      // Saved either way, so stopping mid-check loses no alerts; only the notification is skipped.
      if (!stopped) notifyFired(fresh);
    } catch (error) {
      if (stopped) return;
      // A failed check still counts as one: the next waits the full interval rather than retrying every tick.
      state = { ...state, lastCheckAt: now() };
      deps.persistence.setState(STATE_KEY, state, { schemaVersion: SCHEMA_VERSION });
      status = { ...status, lastCheckAt: state.lastCheckAt, lastError: error instanceof Error ? error.message : String(error) };
    } finally {
      controller = null;
      status = { ...status, running: false };
      refreshSchedule();
      emit();
    }
  };

  const checkNow = () => {
    if (!running) running = run().finally(() => { running = null; });
    return running;
  };

  const tick = async () => {
    if (running) return running;
    const next = refreshSchedule();
    if (next != null && now() >= next) await checkNow();
  };

  return {
    start() {
      stopped = false;
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      // Never keep a CLI process alive for this.
      (timer as { unref?: () => void }).unref?.();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      controller?.abort();
    },
    tick,
    checkNow,
    clearHistory() {
      history = [];
      deps.persistence.setState(HISTORY_KEY, history, { schemaVersion: SCHEMA_VERSION });
      emit();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
