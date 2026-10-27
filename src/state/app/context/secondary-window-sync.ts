import { syncConfigActiveLayoutState, type AppAction, type AppState, type PaneRuntimeState } from "../../../core/state/app/state";
import { getDockedInstanceIds } from "../../../layout/pane-manager/dock-tree";
import { addPaneToLayout, insertAtRootEdge } from "../../../layout/pane-manager/docking";
import { findPaneLocation } from "../../../layout/pane-manager/queries";
import {
  addSecondaryWindow,
  applySecondaryWindowLayoutEdit,
  closeSecondaryWindow,
  movePaneToNewWindow,
  movePaneToWindow,
  secondaryWindowPaneIds,
  windowLayoutEditFromView,
  type WindowMoveTarget,
  type WindowSize,
} from "../../../layout/pane-manager/secondary-windows";
import type { AppConfig, FloatingPaneEntry, LayoutConfig, PaneInstanceConfig } from "../../../types/config";
import type { DesktopSharedStateSnapshot, DesktopWindowIntent, SecondaryWindowStatus } from "../../../types/desktop-window";

export interface WindowIntentOutcome {
  applied: boolean;
  /** For the main window to dispatch, in order. */
  actions: AppAction[];
  /** The config to save, when the change is one the main window saves itself. */
  save: AppConfig | null;
  /** The window to bring forward afterwards ("main" or a layout window id), with the pane to focus there. */
  focus?: { windowId: string; paneId: string | null };
  /** A window's focused pane and size, for the main window to keep. */
  windowStatus?: SecondaryWindowStatus;
  /** App settings changed: the main window announces them as it does its own changes (`config:changed`). */
  configChanged?: AppConfig;
}

/**
 * The app settings a secondary window may change, as its command bar and
 * settings forms do: theme, currency, portfolios and watchlists, brokers,
 * plugins and sources on or off, chart and display preferences, language,
 * keys, time zone, telemetry and the update channel. Layout and tabs go
 * through grid edits, plugin settings through `setPluginConfig`; the rest
 * (data directory, config version, onboarding and migration markers) are the
 * main window's alone.
 */
const WINDOW_SETTABLE_CONFIG_FIELDS: ReadonlySet<string> = new Set<keyof AppConfig>([
  "baseCurrency",
  "refreshIntervalMinutes",
  "portfolios",
  "watchlists",
  "brokerInstances",
  "disabledPlugins",
  "disabledSources",
  "theme",
  "chartPreferences",
  "valueFlashingEnabled",
  "fontSize",
  "recentCommands",
  "language",
  "keybindings",
  "telemetry",
  "updates",
  "timezone",
  "presentationMode",
]);

/** Config a window never sends as a setting: layout and tabs are grid edits, plugin settings their own intent. */
const CONFIG_FIELDS_NOT_SENT: ReadonlySet<string> = new Set<keyof AppConfig>(["layout", "layouts", "activeLayoutIndex", "pluginConfig"]);

const ignoredConfigFields = new Set<string>();

function noteIgnoredConfigField(field: string): void {
  if (ignoredConfigFields.has(field)) return;
  ignoredConfigFields.add(field);
  console.warn("[desktop-window] ignored a secondary window's change to a setting it may not set", { field });
}

/** What the main window knows of the windows, for placing a pane moved between them. */
export interface WindowIntentContext {
  /** What each secondary window last reported, by layout window id. */
  windowStatus?: ReadonlyMap<string, SecondaryWindowStatus>;
  /** The main window's own size. */
  mainSize?: WindowSize | null;
}

const REFUSED: WindowIntentOutcome = { applied: false, actions: [], save: null };
const UNCHANGED: WindowIntentOutcome = { applied: true, actions: [], save: null };

/** A layout change the main window makes for a window: undone with its own undo, and saved. */
function layoutChangeOutcome(state: AppState, layout: LayoutConfig, focus?: WindowIntentOutcome["focus"]): WindowIntentOutcome {
  return {
    applied: true,
    actions: [{ type: "PUSH_LAYOUT_HISTORY" }, { type: "UPDATE_LAYOUT", layout }],
    save: syncConfigActiveLayoutState({ ...state.config, layout }, state.paneState, state.focusedPaneId),
    ...(focus ? { focus } : {}),
  };
}

/**
 * Moving a pane to window `target` ("main", a layout window id, or "new"),
 * from wherever it is: beside the focused pane the target window last
 * reported, a floating pane scaled between the windows' sizes. The main
 * window's own focused pane and size are its state's and `mainSize`.
 */
export function windowMoveOutcome(
  state: AppState,
  paneId: string,
  target: WindowMoveTarget,
  context: WindowIntentContext = {},
): WindowIntentOutcome {
  const layout = state.config.layout;
  if (target === "new") {
    const moved = movePaneToNewWindow(layout, paneId);
    return moved ? layoutChangeOutcome(state, moved.layout, { windowId: moved.windowId, paneId }) : REFUSED;
  }
  const statusOf = (windowId: string | undefined): SecondaryWindowStatus | undefined => {
    if (!windowId) return undefined;
    return windowId === "main"
      ? { focusedPaneId: state.focusedPaneId, size: context.mainSize ?? null }
      : context.windowStatus?.get(windowId);
  };
  const source = statusOf(findPaneLocation(layout, paneId)?.window);
  const destination = statusOf(target);
  const next = movePaneToWindow(layout, paneId, target, {
    anchorId: destination?.focusedPaneId ?? null,
    sourceSize: source?.size ?? undefined,
    targetSize: destination?.size ?? undefined,
  });
  return next ? layoutChangeOutcome(state, next, { windowId: target, paneId }) : REFUSED;
}

/**
 * Where a window's panes sit, leaving out which floating pane is on top:
 * focusing one raises it, and that is not an edit to undo.
 */
function windowArrangement(layout: LayoutConfig, windowId: string): string {
  const window = layout.windows?.find((candidate) => candidate.id === windowId);
  if (!window) return "null";
  const floating = window.floating
    .map(({ instanceId, x, y, width, height }) => [instanceId, x, y, width, height] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([window.dockRoot, floating]);
}

/**
 * How the main window applies a change secondary window `windowId` asked for.
 * The window is the one the host names, never one the change claims, and only
 * that window's panes take it. A grid edit is undone with the main window's
 * own undo, like any other layout edit; pane state and settings are not.
 */
export function applyWindowIntent(
  state: AppState,
  windowId: string,
  intent: DesktopWindowIntent,
  context: WindowIntentContext = {},
): WindowIntentOutcome {
  const layout = state.config.layout;
  switch (intent.type) {
    case "movePane": {
      // A window moves only its own panes, and never to itself.
      if (intent.target === windowId || !secondaryWindowPaneIds(layout, windowId).includes(intent.paneId)) return REFUSED;
      return windowMoveOutcome(state, intent.paneId, intent.target, context);
    }
    case "addWindow": {
      const added = addSecondaryWindow(layout);
      return layoutChangeOutcome(state, added.layout, { windowId: added.windowId, paneId: null });
    }
    case "closeWindow": {
      // Gone already, by another route: nothing for the host to do instead.
      if (!layout.windows?.some((window) => window.id === windowId)) return UNCHANGED;
      return layoutChangeOutcome(state, closeSecondaryWindow(layout, windowId));
    }
    case "windowStatus":
      return { ...UNCHANGED, windowStatus: intent.status };
    case "editLayout": {
      const next = applySecondaryWindowLayoutEdit(layout, { ...intent.edit, windowId });
      if (!next) return REFUSED;
      if (JSON.stringify(next) === JSON.stringify(layout)) return UNCHANGED;
      const rearranged = windowArrangement(next, windowId) !== windowArrangement(layout, windowId)
        || next.instances.length !== layout.instances.length;
      return {
        applied: true,
        actions: [
          ...(rearranged ? [{ type: "PUSH_LAYOUT_HISTORY" } as const] : []),
          { type: "UPDATE_LAYOUT", layout: next },
        ],
        save: syncConfigActiveLayoutState({ ...state.config, layout: next }, state.paneState, state.focusedPaneId),
      };
    }
    case "replacePaneState": {
      const own = new Set(secondaryWindowPaneIds(layout, windowId));
      const actions: AppAction[] = Object.entries(intent.paneState)
        .filter(([paneId, paneState]) => own.has(paneId)
          && JSON.stringify(state.paneState[paneId] ?? {}) !== JSON.stringify(paneState))
        .map(([paneId, paneState]) => ({ type: "REPLACE_PANE_STATE", paneId, state: paneState }));
      return { applied: true, actions, save: null };
    }
    case "setPluginConfig": {
      const pluginConfig = { ...state.config.pluginConfig };
      for (const [pluginId, values] of Object.entries(intent.values)) {
        if (values) pluginConfig[pluginId] = values;
        else delete pluginConfig[pluginId];
      }
      const config = { ...state.config, pluginConfig };
      return { applied: true, actions: [{ type: "SET_CONFIG", config }], save: config, configChanged: config };
    }
    case "setConfig": {
      const fields: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(intent.fields)) {
        if (!WINDOW_SETTABLE_CONFIG_FIELDS.has(field)) {
          noteIgnoredConfigField(field);
          continue;
        }
        if (JSON.stringify(state.config[field as keyof AppConfig]) !== JSON.stringify(value)) fields[field] = value;
      }
      if (Object.keys(fields).length === 0) return UNCHANGED;
      const config = { ...state.config, ...fields } as AppConfig;
      return { applied: true, actions: [{ type: "SET_CONFIG", config }], save: config, configChanged: config };
    }
    case "updateInstances": {
      // Any window's pane may take the change, but not a new type, a new pane or a new place.
      const incoming = new Map(intent.instances.map((instance) => [instance.instanceId, instance] as const));
      let changed = false;
      const instances = layout.instances.map((instance) => {
        const next = incoming.get(instance.instanceId);
        if (!next) return instance;
        const { placementMemory: _placementMemory, movedFrom: _movedFrom, ...content } = next;
        const updated: PaneInstanceConfig = {
          ...content,
          instanceId: instance.instanceId,
          paneId: instance.paneId,
          ...(instance.placementMemory ? { placementMemory: instance.placementMemory } : {}),
          ...(instance.movedFrom ? { movedFrom: instance.movedFrom } : {}),
        };
        if (JSON.stringify(updated) === JSON.stringify(instance)) return instance;
        changed = true;
        return updated;
      });
      if (!changed) return UNCHANGED;
      const next = { ...layout, instances };
      return {
        applied: true,
        actions: [{ type: "UPDATE_LAYOUT", layout: next }],
        save: syncConfigActiveLayoutState({ ...state.config, layout: next }, state.paneState, state.focusedPaneId),
      };
    }
  }
}

/** The panes a window's view shows as its own: the grid and floating panes in the main window's place. */
function viewPaneIds(layout: LayoutConfig): string[] {
  return [...getDockedInstanceIds(layout.dockRoot), ...layout.floating.map((entry) => entry.instanceId)];
}

function layoutSignature(layout: LayoutConfig, windowId: string): string {
  const edit = windowLayoutEditFromView(layout, windowId, []);
  return JSON.stringify([edit.dockRoot, edit.floating, edit.instances]);
}

function paneStateSignature(paneState: PaneRuntimeState | undefined): string {
  return JSON.stringify(paneState ?? {});
}

function pluginConfigSignatures(config: AppConfig): Map<string, string> {
  return new Map(Object.entries(config.pluginConfig).map(([pluginId, values]) => [pluginId, JSON.stringify(values)]));
}

function adjust(counts: Map<string, number>, key: string, delta: number): void {
  const next = (counts.get(key) ?? 0) + delta;
  if (next > 0) counts.set(key, next);
  else counts.delete(key);
}

/** The config fields a window sends as settings, with their values' signatures. */
function settingSignatures(config: AppConfig): Map<string, string> {
  return new Map(Object.entries(config)
    .filter(([field]) => !CONFIG_FIELDS_NOT_SENT.has(field))
    .map(([field, value]) => [field, JSON.stringify(value ?? null)]));
}

/** Pane instances in the view that are not the window's own: the panes of other windows. */
function foreignInstanceSignatures(layout: LayoutConfig): Map<string, string> {
  const own = new Set(viewPaneIds(layout));
  return new Map(layout.instances
    .filter((instance) => !own.has(instance.instanceId))
    .map((instance) => [instance.instanceId, JSON.stringify(instance)]));
}

/** A pane opened in the window whose edit the main window refused, to open again on its newer state. */
interface PendingReplay {
  instance: PaneInstanceConfig;
  floating: FloatingPaneEntry | null;
  paneState: PaneRuntimeState | undefined;
}

/**
 * A secondary window's side of keeping the main window the only writer. The
 * window edits its own view at once; this works out which of those edits to
 * send as intents, and keeps them over snapshots from the main window that
 * were sent before it applied them. A change counts as sent until the main
 * window answers; once it has, every later snapshot already carries it, since
 * the host relays the answer after the snapshots before it.
 */
export class SecondaryWindowSync {
  /** Local state as of the last snapshot taken in, so a change since then is the window's own. */
  private syncedLayout = "";
  private syncedPaneState = new Map<string, string>();
  private syncedPluginConfig = new Map<string, string>();
  private syncedSettings = new Map<string, string>();
  private syncedForeignInstances = new Map<string, string>();
  /** The window's panes as the main window last reported them. */
  private mainPaneIds: string[] = [];
  /** Every pane instance the main window's layout last had. */
  private mainInstanceIds = new Set<string>();
  private sentLayout: { signature: string; paneIds: string[]; openedIds: string[] } | null = null;
  private readonly sentPaneState = new Map<string, string>();
  private readonly sentPluginConfig = new Map<string, string>();
  private readonly sentSettings = new Map<string, string>();
  private readonly sentForeignInstances = new Map<string, string>();
  private layoutInFlight = 0;
  private readonly paneStateInFlight = new Map<string, number>();
  private readonly pluginConfigInFlight = new Map<string, number>();
  private readonly settingsInFlight = new Map<string, number>();
  private readonly foreignInstancesInFlight = new Map<string, number>();
  /** Panes opened here whose edit was refused, to open again once; and those already opened again. */
  private readonly pendingReplays = new Map<string, PendingReplay>();
  private readonly replayedIds = new Set<string>();

  constructor(readonly windowId: string) {}

  /** The first snapshot, already in local state. */
  start(view: DesktopSharedStateSnapshot, local: AppState): void {
    this.noteMain(view);
    this.noteSynced(local);
  }

  private noteMain(view: DesktopSharedStateSnapshot): void {
    this.mainPaneIds = viewPaneIds(view.config.layout);
    this.mainInstanceIds = new Set(view.config.layout.instances.map((instance) => instance.instanceId));
  }

  /** A snapshot from the main window, with what this window sent and has not heard back about laid over it. */
  receive(view: DesktopSharedStateSnapshot, local: AppState): DesktopSharedStateSnapshot {
    this.noteMain(view);
    let config = view.config;
    if (this.layoutInFlight > 0) {
      const own = new Set(viewPaneIds(local.config.layout));
      const localInstances = new Map(local.config.layout.instances
        .filter((instance) => own.has(instance.instanceId))
        .map((instance) => [instance.instanceId, instance] as const));
      const closedHere = new Set(this.mainPaneIds.filter((paneId) => !own.has(paneId)));
      const known = new Set(config.layout.instances.map((instance) => instance.instanceId));
      config = {
        ...config,
        layout: {
          ...config.layout,
          dockRoot: local.config.layout.dockRoot,
          floating: local.config.layout.floating,
          instances: [
            ...config.layout.instances
              .filter((instance) => !closedHere.has(instance.instanceId))
              .map((instance) => localInstances.get(instance.instanceId) ?? instance),
            // Opened here and not yet in the main window's layout.
            ...[...localInstances.values()].filter((instance) => !known.has(instance.instanceId)),
          ],
        },
      };
    }
    if (this.foreignInstancesInFlight.size > 0) {
      const localInstances = new Map(local.config.layout.instances.map((instance) => [instance.instanceId, instance] as const));
      config = {
        ...config,
        layout: {
          ...config.layout,
          instances: config.layout.instances.map((instance) => (
            this.foreignInstancesInFlight.has(instance.instanceId) ? localInstances.get(instance.instanceId) ?? instance : instance
          )),
        },
      };
    }
    if (this.pluginConfigInFlight.size > 0) {
      const pluginConfig = { ...config.pluginConfig };
      for (const pluginId of this.pluginConfigInFlight.keys()) {
        const values = local.config.pluginConfig[pluginId];
        if (values) pluginConfig[pluginId] = values;
        else delete pluginConfig[pluginId];
      }
      config = { ...config, pluginConfig };
    }
    if (this.settingsInFlight.size > 0) {
      const settings: Record<string, unknown> = {};
      for (const field of this.settingsInFlight.keys()) settings[field] = local.config[field as keyof AppConfig];
      config = { ...config, ...settings } as AppConfig;
    }
    let paneState = view.paneState;
    if (this.paneStateInFlight.size > 0) {
      paneState = { ...paneState };
      for (const paneId of this.paneStateInFlight.keys()) {
        const sent = local.paneState[paneId];
        if (sent) paneState[paneId] = sent;
      }
    }
    // Focus is the window's own: the main window's focused pane is in another window.
    return { ...view, config, paneState, focusedPaneId: local.focusedPaneId };
  }

  /** Local state right after taking in a snapshot. */
  noteSynced(local: AppState): void {
    this.syncedLayout = layoutSignature(local.config.layout, this.windowId);
    this.syncedPaneState = new Map(viewPaneIds(local.config.layout)
      .map((paneId) => [paneId, paneStateSignature(local.paneState[paneId])]));
    this.syncedPluginConfig = pluginConfigSignatures(local.config);
    this.syncedSettings = settingSignatures(local.config);
    this.syncedForeignInstances = foreignInstanceSignatures(local.config.layout);
  }

  /** The intents for what changed here since the last snapshot and has not been sent yet, each now counted as sent. */
  collect(local: AppState): DesktopWindowIntent[] {
    const intents: DesktopWindowIntent[] = [];
    const layout = local.config.layout;

    const signature = layoutSignature(layout, this.windowId);
    if (signature !== this.syncedLayout && signature !== this.sentLayout?.signature) {
      // An edit builds on the one still in flight, which the main window will have applied first.
      const base = this.layoutInFlight > 0 && this.sentLayout ? this.sentLayout.paneIds : this.mainPaneIds;
      const edit = windowLayoutEditFromView(layout, this.windowId, base);
      intents.push({ type: "editLayout", edit });
      const paneIds = viewPaneIds(layout);
      this.sentLayout = { signature, paneIds, openedIds: paneIds.filter((paneId) => !this.mainInstanceIds.has(paneId)) };
      this.layoutInFlight += 1;
    }

    const paneState: Record<string, PaneRuntimeState> = {};
    for (const paneId of viewPaneIds(layout)) {
      const current = paneStateSignature(local.paneState[paneId]);
      if (current === this.syncedPaneState.get(paneId) || current === this.sentPaneState.get(paneId)) continue;
      paneState[paneId] = local.paneState[paneId] ?? {};
      this.sentPaneState.set(paneId, current);
      adjust(this.paneStateInFlight, paneId, 1);
    }
    if (Object.keys(paneState).length > 0) intents.push({ type: "replacePaneState", paneState });

    const instances: PaneInstanceConfig[] = [];
    for (const [paneId, current] of foreignInstanceSignatures(layout)) {
      const synced = this.syncedForeignInstances.get(paneId);
      // Only a pane the main window has, changed here: never one it does not know, never one left alone.
      if (synced === undefined || current === synced || current === this.sentForeignInstances.get(paneId)) continue;
      const instance = layout.instances.find((candidate) => candidate.instanceId === paneId);
      if (!instance) continue;
      instances.push(instance);
      this.sentForeignInstances.set(paneId, current);
      adjust(this.foreignInstancesInFlight, paneId, 1);
    }
    if (instances.length > 0) intents.push({ type: "updateInstances", instances });

    const values: Record<string, Record<string, unknown> | null> = {};
    const current = pluginConfigSignatures(local.config);
    for (const pluginId of new Set([...current.keys(), ...this.syncedPluginConfig.keys()])) {
      const next = current.get(pluginId) ?? "null";
      if (next === (this.syncedPluginConfig.get(pluginId) ?? "null") || next === this.sentPluginConfig.get(pluginId)) continue;
      values[pluginId] = local.config.pluginConfig[pluginId] ?? null;
      this.sentPluginConfig.set(pluginId, next);
      adjust(this.pluginConfigInFlight, pluginId, 1);
    }
    if (Object.keys(values).length > 0) intents.push({ type: "setPluginConfig", values });

    // Only the settings changed here: one left alone is never sent, so it cannot undo main's.
    const fields: Record<string, unknown> = {};
    const settings = settingSignatures(local.config);
    for (const field of new Set([...settings.keys(), ...this.syncedSettings.keys()])) {
      const next = settings.get(field) ?? "null";
      if (next === (this.syncedSettings.get(field) ?? "null") || next === this.sentSettings.get(field)) continue;
      fields[field] = local.config[field as keyof AppConfig];
      this.sentSettings.set(field, next);
      adjust(this.settingsInFlight, field, 1);
    }
    if (Object.keys(fields).length > 0) intents.push({ type: "setConfig", fields: fields as Partial<AppConfig> });

    return intents;
  }

  /**
   * The main window answered an intent from `collect`, with local state as it
   * is now. True when it refused, and the window should take the main
   * window's state back in; a pane opened here in a refused edit is kept, for
   * `replay` to open again on that state.
   */
  settle(intent: DesktopWindowIntent, applied: boolean, local: AppState): boolean {
    switch (intent.type) {
      case "editLayout":
        if (!applied) this.keepOpenedPanes(intent, local);
        // An edit after a refused one built on it, so it is refused too.
        this.layoutInFlight = applied ? Math.max(0, this.layoutInFlight - 1) : 0;
        if (!applied) this.sentLayout = null;
        break;
      case "replacePaneState":
        for (const paneId of Object.keys(intent.paneState)) {
          adjust(this.paneStateInFlight, paneId, -1);
          if (!applied) this.sentPaneState.delete(paneId);
        }
        break;
      case "updateInstances":
        for (const instance of intent.instances) {
          adjust(this.foreignInstancesInFlight, instance.instanceId, -1);
          if (!applied) this.sentForeignInstances.delete(instance.instanceId);
        }
        break;
      case "setPluginConfig":
        for (const pluginId of Object.keys(intent.values)) {
          adjust(this.pluginConfigInFlight, pluginId, -1);
          if (!applied) this.sentPluginConfig.delete(pluginId);
        }
        break;
      case "setConfig":
        for (const field of Object.keys(intent.fields)) {
          adjust(this.settingsInFlight, field, -1);
          if (!applied) this.sentSettings.delete(field);
        }
        break;
    }
    return !applied;
  }

  private keepOpenedPanes(intent: Extract<DesktopWindowIntent, { type: "editLayout" }>, local: AppState): void {
    const opened = new Set(this.sentLayout?.openedIds ?? []);
    for (const instance of intent.edit.instances) {
      const paneId = instance.instanceId;
      if (!opened.has(paneId) || this.mainInstanceIds.has(paneId) || this.replayedIds.has(paneId)) continue;
      this.pendingReplays.set(paneId, {
        instance,
        floating: intent.edit.floating.find((entry) => entry.instanceId === paneId) ?? null,
        paneState: local.paneState[paneId],
      });
    }
  }

  /**
   * The window's view with the panes opened here in a refused edit opened
   * again, after taking the main window's newer state in, and their state;
   * null when there are none. Each is opened again once: if that edit is
   * refused too, the pane is gone.
   */
  replay(local: AppState): { layout: LayoutConfig; paneState: Record<string, PaneRuntimeState> } | null {
    if (this.pendingReplays.size === 0) return null;
    let layout = local.config.layout;
    const paneState: Record<string, PaneRuntimeState> = {};
    for (const [paneId, pending] of this.pendingReplays) {
      this.replayedIds.add(paneId);
      if (layout.instances.some((instance) => instance.instanceId === paneId)) continue;
      if (pending.floating) {
        layout = { ...layout, instances: [...layout.instances, pending.instance], floating: [...layout.floating, { ...pending.floating }] };
      } else {
        const anchor = local.focusedPaneId;
        layout = anchor && getDockedInstanceIds(layout.dockRoot).includes(anchor)
          ? addPaneToLayout(layout, pending.instance, { relativeTo: anchor, position: "right" })
          : insertAtRootEdge({ ...layout, instances: [...layout.instances, pending.instance] }, paneId, "right");
      }
      if (pending.paneState) paneState[paneId] = pending.paneState;
      // Sent once already, with the edit that was refused: it is a change again.
      this.sentPaneState.delete(paneId);
    }
    this.pendingReplays.clear();
    return { layout, paneState };
  }
}
