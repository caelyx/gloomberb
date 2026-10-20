import {
  removePaneInstances,
  type DockLayoutNode,
  type FloatingPaneEntry,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../../types/config";
import { getDockedInstanceIds, getDockLeafLayouts, type LayoutBounds } from "./dock-tree";
import { dockPane, insertAtRootEdge } from "./docking";
import { detachPane, finalizeLayout } from "./layout-state";
import { findPaneLocation, isPaneInLayout } from "./queries";

const FLATTENED_WINDOW_BOUNDS: LayoutBounds = { x: 0, y: 0, width: 120, height: 40 };

/**
 * The layout with every secondary window's panes floating in the main window:
 * docked ones where their window's grid would put them in `bounds`, floating
 * ones at their own rect. For a format or renderer that has no secondary
 * windows, such as a shared layout.
 */
export function flattenSecondaryWindows(layout: LayoutConfig, bounds: LayoutBounds = FLATTENED_WINDOW_BOUNDS): LayoutConfig {
  const { windows, ...rest } = layout;
  if (!windows || windows.length === 0) return rest;
  const floating = [...layout.floating];
  for (const window of windows) {
    for (const leaf of getDockLeafLayouts({ ...layout, dockRoot: window.dockRoot }, bounds)) {
      floating.push({ instanceId: leaf.instanceId, ...leaf.rect });
    }
    floating.push(...window.floating.map((entry) => ({ ...entry })));
  }
  return { ...rest, floating };
}

/** The first free short id: `w2` for the window beside the main one, then `w3`, and so on. */
function nextSecondaryWindowId(layout: LayoutConfig): string {
  const used = new Set((layout.windows ?? []).map((window) => window.id));
  let index = 2;
  while (used.has(`w${index}`)) index += 1;
  return `w${index}`;
}

/** Takes the pane from wherever it is into a new secondary window of its own; null when the layout has no such pane. */
export function movePaneToNewWindow(
  layout: LayoutConfig,
  instanceId: string,
): { layout: LayoutConfig; windowId: string } | null {
  if (!isPaneInLayout(layout, instanceId)) return null;
  const windowId = nextSecondaryWindowId(layout);
  const base = detachPane(layout, instanceId);
  return {
    windowId,
    layout: finalizeLayout({
      ...base,
      windows: [...(base.windows ?? []), { id: windowId, dockRoot: { kind: "pane", instanceId }, floating: [] }],
    }),
  };
}

/**
 * Docks the pane in the main window, to the right of `anchorId` when that is
 * docked there, else at the grid's right edge. The window it leaves stays
 * open, even when that empties it.
 */
export function movePaneToMainWindow(layout: LayoutConfig, instanceId: string, anchorId?: string | null): LayoutConfig {
  const anchor = anchorId && anchorId !== instanceId ? findPaneLocation(layout, anchorId) : null;
  if (anchorId && anchor?.window === "main" && anchor.kind === "docked") {
    return dockPane(layout, instanceId, { relativeTo: anchorId, position: "right" });
  }
  return insertAtRootEdge(layout, instanceId, "right");
}

/**
 * Closing a window keeps its panes: its grid joins the main window's on the
 * right as one block, as it was arranged, and its floating panes float there.
 */
export function closeSecondaryWindow(layout: LayoutConfig, windowId: string): LayoutConfig {
  const window = layout.windows?.find((candidate) => candidate.id === windowId);
  if (!window) return layout;
  const dockRoot = layout.dockRoot && window.dockRoot
    ? { kind: "split" as const, axis: "horizontal" as const, ratio: 0.5, first: layout.dockRoot, second: window.dockRoot }
    : layout.dockRoot ?? window.dockRoot;
  return finalizeLayout({
    ...layout,
    dockRoot,
    floating: [...layout.floating, ...window.floating],
    windows: (layout.windows ?? []).filter((candidate) => candidate.id !== windowId),
  });
}

/** The id the main window's grid goes under in a secondary window's view of the layout. */
const MAIN_WINDOW_VIEW_ID = "main-window";

/**
 * The layout as a secondary window shows it: its own grid and floating panes
 * in the main window's place, and the main window's among the other windows.
 * Every pane stays placed, so following, focus and hidden-pane handling work
 * on the window's panes the way they do in the main window. A view only; it is
 * never saved.
 */
export function viewLayoutFromWindow(layout: LayoutConfig, windowId: string): LayoutConfig {
  const windows = layout.windows ?? [];
  const window = windows.find((candidate) => candidate.id === windowId);
  return {
    ...layout,
    dockRoot: window?.dockRoot ?? null,
    floating: window?.floating ?? [],
    windows: [
      { id: MAIN_WINDOW_VIEW_ID, dockRoot: layout.dockRoot, floating: layout.floating },
      ...windows.filter((candidate) => candidate.id !== windowId),
    ],
  };
}

/** The panes in secondary window `windowId`: its grid's, then its floating ones. */
export function secondaryWindowPaneIds(layout: LayoutConfig, windowId: string): string[] {
  const window = layout.windows?.find((candidate) => candidate.id === windowId);
  return window ? [...getDockedInstanceIds(window.dockRoot), ...window.floating.map((entry) => entry.instanceId)] : [];
}

/**
 * What a secondary window changed in its own grid, for the main window to
 * apply: the main window is the only one that writes the layout.
 */
export interface SecondaryWindowLayoutEdit {
  windowId: string;
  /** The window's panes in the state the edit was made on; an edit made on an older state is dropped. */
  basePaneIds: string[];
  dockRoot: DockLayoutNode | null;
  floating: FloatingPaneEntry[];
  /** The window's own pane instances, with any title, settings or link changed there. */
  instances: PaneInstanceConfig[];
}

/** The edit a window's view of the layout (see `viewLayoutFromWindow`) makes to that window. */
export function windowLayoutEditFromView(view: LayoutConfig, windowId: string, basePaneIds: readonly string[]): SecondaryWindowLayoutEdit {
  const paneIds = new Set([...getDockedInstanceIds(view.dockRoot), ...view.floating.map((entry) => entry.instanceId)]);
  return {
    windowId,
    basePaneIds: [...basePaneIds],
    dockRoot: view.dockRoot,
    floating: view.floating,
    instances: view.instances.filter((instance) => paneIds.has(instance.instanceId)),
  };
}

/**
 * The layout with a secondary window's edit applied, or null when it cannot
 * be: the window is gone, its panes changed since the edit was made, or the
 * edit places a pane that is not the window's. A pane the edit no longer
 * places was closed there and leaves the layout. Only the window's own
 * instances take the edit's changes, and none changes its pane type.
 */
export function applySecondaryWindowLayoutEdit(layout: LayoutConfig, edit: SecondaryWindowLayoutEdit): LayoutConfig | null {
  const windows = layout.windows ?? [];
  if (!windows.some((window) => window.id === edit.windowId)) return null;
  const current = secondaryWindowPaneIds(layout, edit.windowId);
  const currentIds = new Set(current);
  if (current.length !== edit.basePaneIds.length || edit.basePaneIds.some((id) => !currentIds.has(id))) return null;
  const incoming = [...getDockedInstanceIds(edit.dockRoot), ...edit.floating.map((entry) => entry.instanceId)];
  if (incoming.some((id) => !currentIds.has(id))) return null;
  const incomingIds = new Set(incoming);
  const editedInstances = new Map(edit.instances
    .filter((instance) => incomingIds.has(instance.instanceId))
    .map((instance) => [instance.instanceId, instance] as const));
  const spliced: LayoutConfig = {
    ...layout,
    instances: layout.instances.map((instance) => {
      const edited = editedInstances.get(instance.instanceId);
      return edited ? { ...edited, instanceId: instance.instanceId, paneId: instance.paneId } : instance;
    }),
    windows: windows.map((window) => (
      window.id === edit.windowId ? { id: window.id, dockRoot: edit.dockRoot, floating: edit.floating } : window
    )),
  };
  const closed = current.filter((id) => !incomingIds.has(id));
  return finalizeLayout(closed.length > 0 ? removePaneInstances(spliced, closed) : spliced);
}
