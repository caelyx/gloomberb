import { syncConfigActiveLayoutState, type AppAction, type AppState, type PaneRuntimeState } from "../../../core/state/app/state";
import { getDockedInstanceIds } from "../../../layout/pane-manager/dock-tree";
import {
  applySecondaryWindowLayoutEdit,
  secondaryWindowPaneIds,
  windowLayoutEditFromView,
} from "../../../layout/pane-manager/secondary-windows";
import type { AppConfig, LayoutConfig } from "../../../types/config";
import type { DesktopSharedStateSnapshot, DesktopWindowIntent } from "../../../types/desktop-window";

export interface WindowIntentOutcome {
  applied: boolean;
  /** For the main window to dispatch, in order. */
  actions: AppAction[];
  /** The config to save, when the change is one the main window saves itself. */
  save: AppConfig | null;
}

const REFUSED: WindowIntentOutcome = { applied: false, actions: [], save: null };
const UNCHANGED: WindowIntentOutcome = { applied: true, actions: [], save: null };

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
export function applyWindowIntent(state: AppState, windowId: string, intent: DesktopWindowIntent): WindowIntentOutcome {
  const layout = state.config.layout;
  switch (intent.type) {
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
      return { applied: true, actions: [{ type: "SET_CONFIG", config }], save: config };
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
  /** The window's panes as the main window last reported them. */
  private mainPaneIds: string[] = [];
  private sentLayout: { signature: string; paneIds: string[] } | null = null;
  private readonly sentPaneState = new Map<string, string>();
  private readonly sentPluginConfig = new Map<string, string>();
  private layoutInFlight = 0;
  private readonly paneStateInFlight = new Map<string, number>();
  private readonly pluginConfigInFlight = new Map<string, number>();

  constructor(readonly windowId: string) {}

  /** The first snapshot, already in local state. */
  start(view: DesktopSharedStateSnapshot, local: AppState): void {
    this.mainPaneIds = viewPaneIds(view.config.layout);
    this.noteSynced(local);
  }

  /** A snapshot from the main window, with what this window sent and has not heard back about laid over it. */
  receive(view: DesktopSharedStateSnapshot, local: AppState): DesktopSharedStateSnapshot {
    this.mainPaneIds = viewPaneIds(view.config.layout);
    let config = view.config;
    if (this.layoutInFlight > 0) {
      const own = new Set(viewPaneIds(local.config.layout));
      const localInstances = new Map(local.config.layout.instances
        .filter((instance) => own.has(instance.instanceId))
        .map((instance) => [instance.instanceId, instance] as const));
      const closedHere = new Set(this.mainPaneIds.filter((paneId) => !own.has(paneId)));
      config = {
        ...config,
        layout: {
          ...config.layout,
          dockRoot: local.config.layout.dockRoot,
          floating: local.config.layout.floating,
          instances: config.layout.instances
            .filter((instance) => !closedHere.has(instance.instanceId))
            .map((instance) => localInstances.get(instance.instanceId) ?? instance),
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
      this.sentLayout = { signature, paneIds: viewPaneIds(layout) };
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

    return intents;
  }

  /**
   * The main window answered an intent from `collect`. True when it refused,
   * and the window should take the main window's state back in.
   */
  settle(intent: DesktopWindowIntent, applied: boolean): boolean {
    switch (intent.type) {
      case "editLayout":
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
      case "setPluginConfig":
        for (const pluginId of Object.keys(intent.values)) {
          adjust(this.pluginConfigInFlight, pluginId, -1);
          if (!applied) this.sentPluginConfig.delete(pluginId);
        }
        break;
    }
    return !applied;
  }
}
