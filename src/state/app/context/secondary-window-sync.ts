import { syncConfigActiveLayoutState, type AppAction, type AppState, type PaneRuntimeState } from "../../../core/state/app/state";
import { getDockedInstanceIds } from "../../../layout/pane-manager/dock-tree";
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
import type { AppConfig, LayoutConfig } from "../../../types/config";
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
