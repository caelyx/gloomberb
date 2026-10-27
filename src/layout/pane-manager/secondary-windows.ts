import {
  removePaneInstances,
  type DockLayoutNode,
  type FloatingPaneEntry,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../../types/config";
import { getDockedInstanceIds, getDockLeafLayouts, type LayoutBounds } from "./dock-tree";
import { dockPane, insertAtRootEdge } from "./docking";
import { clampFloatingRect, maxFloatingZ, type FloatingRect } from "./floating";
import { captureDockedMemory, detachPane, finalizeLayout } from "./layout-state";
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

const MAIN_WINDOW_LABEL = "Main window";

function secondaryWindowNumber(windowId: string): number | null {
  const number = /^w(\d+)$/.exec(windowId)?.[1];
  return number ? Number(number) : null;
}

/** "w2" reads as "Window 2", in menus as in the window's title. */
export function secondaryWindowLabel(windowId: string): string {
  const number = secondaryWindowNumber(windowId);
  return number === null ? "Window" : `Window ${number}`;
}

/**
 * A window's name as a window's own view of the layout holds it: "main", or
 * the id a secondary window's view gives the main window's grid, reads as
 * the main window.
 */
export function windowLabelInView(windowId: string): string {
  return windowId === "main" || windowId === MAIN_WINDOW_VIEW_ID ? MAIN_WINDOW_LABEL : secondaryWindowLabel(windowId);
}

/** Where Move to can send a pane: the main window, a secondary window by id, or a new window. */
export type WindowMoveTarget = "main" | "new" | (string & {});

/**
 * The windows a pane in window `currentWindowId` (null for the main window)
 * can move to, in order: the main window, the other secondary windows by
 * number, then a new one. `layout` may be a secondary window's view.
 */
export function windowMoveTargets(
  layout: LayoutConfig,
  currentWindowId: string | null,
): Array<{ target: WindowMoveTarget; label: string }> {
  const others = (layout.windows ?? [])
    .map((window) => window.id)
    .filter((id) => id !== MAIN_WINDOW_VIEW_ID && id !== currentWindowId)
    .sort((a, b) => (secondaryWindowNumber(a) ?? Number.MAX_SAFE_INTEGER) - (secondaryWindowNumber(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
  return [
    ...(currentWindowId ? [{ target: "main" as const, label: MAIN_WINDOW_LABEL }] : []),
    ...others.map((id) => ({ target: id, label: secondaryWindowLabel(id) })),
    { target: "new" as const, label: "New window" },
  ];
}

/** A new, empty secondary window. */
export function addSecondaryWindow(layout: LayoutConfig): { layout: LayoutConfig; windowId: string } {
  const windowId = nextSecondaryWindowId(layout);
  return {
    windowId,
    layout: { ...layout, windows: [...(layout.windows ?? []), { id: windowId, dockRoot: null, floating: [] }] },
  };
}

/**
 * Runs a main-window layout operation on window `windowId`'s grid instead:
 * the window takes the main window's place for it, then goes back. "main"
 * runs it on the main window's grid.
 */
function onWindowGrid(layout: LayoutConfig, windowId: string, edit: (grid: LayoutConfig) => LayoutConfig): LayoutConfig {
  if (windowId === "main") return edit(layout);
  const edited = edit(viewLayoutFromWindow(layout, windowId));
  const others = new Map((edited.windows ?? []).map((window) => [window.id, window] as const));
  const main = others.get(MAIN_WINDOW_VIEW_ID);
  return {
    ...edited,
    dockRoot: main?.dockRoot ?? null,
    floating: main?.floating ?? [],
    windows: (layout.windows ?? []).map((window) => (
      window.id === windowId
        ? { id: windowId, dockRoot: edited.dockRoot, floating: edited.floating }
        : others.get(window.id) ?? window
    )),
  };
}

function windowGrid(layout: LayoutConfig, windowId: string): Pick<LayoutConfig, "dockRoot" | "floating"> | null {
  if (windowId === "main") return layout;
  return layout.windows?.find((window) => window.id === windowId) ?? null;
}

/** A window's size in the cells its floating panes are measured in. */
export interface WindowSize {
  width: number;
  height: number;
}

function scaledFloatingRect(entry: FloatingPaneEntry, from?: WindowSize, to?: WindowSize): FloatingRect {
  if (!from || !to || from.width <= 0 || from.height <= 0) return { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  return clampFloatingRect({
    x: entry.x * scaleX,
    y: entry.y * scaleY,
    width: entry.width * scaleX,
    height: entry.height * scaleY,
  }, to.width, to.height);
}

/**
 * Moves a pane from its window to window `target` ("main" for the main
 * window); null when the pane is not placed, is there already, or the target
 * does not exist. A floating pane floats there, its rect scaled from
 * `sourceSize` to `targetSize` when both are known. A docked one goes back to
 * where it sat if it was moved out of that window before, else right of
 * `anchorId` when that is docked there, else at the grid's right edge. Where
 * it sat in the window it leaves is remembered for the way back.
 */
export function movePaneToWindow(
  layout: LayoutConfig,
  instanceId: string,
  target: string,
  options: { anchorId?: string | null; sourceSize?: WindowSize; targetSize?: WindowSize } = {},
): LayoutConfig | null {
  const location = findPaneLocation(layout, instanceId);
  if (!location || location.window === target || !windowGrid(layout, target)) return null;
  const source = location.kind === "detached" ? null : windowGrid(layout, location.window);
  const floatingEntry = location.kind === "floating"
    ? source?.floating.find((entry) => entry.instanceId === instanceId) ?? null
    : null;
  // Read before leaving: leaving records where the pane sat in this window instead.
  const memory = layout.instances.find((instance) => instance.instanceId === instanceId)?.placementMemory?.window;
  const leftFrom = location.kind === "docked" ? captureDockedMemory(source?.dockRoot ?? null).get(instanceId) : undefined;
  const remembered: LayoutConfig = leftFrom
    ? {
      ...layout,
      instances: layout.instances.map((instance) => (
        instance.instanceId === instanceId
          ? { ...instance, placementMemory: { ...instance.placementMemory, window: { ...leftFrom, windowId: location.window } } }
          : instance
      )),
    }
    : layout;
  const base = detachPane(remembered, instanceId);

  if (floatingEntry) {
    const rect = scaledFloatingRect(floatingEntry, options.sourceSize, options.targetSize);
    return finalizeLayout(onWindowGrid(base, target, (grid) => ({
      ...grid,
      floating: [...grid.floating, { instanceId, ...rect, zIndex: maxFloatingZ(grid) + 1 }],
    })));
  }

  return finalizeLayout(onWindowGrid(base, target, (grid) => {
    const docked = new Set(getDockedInstanceIds(grid.dockRoot));
    if (memory?.windowId === target && memory.anchorInstanceId && memory.position && docked.has(memory.anchorInstanceId)) {
      return dockPane(grid, instanceId, { relativeTo: memory.anchorInstanceId, position: memory.position });
    }
    if (options.anchorId && options.anchorId !== instanceId && docked.has(options.anchorId)) {
      return dockPane(grid, instanceId, { relativeTo: options.anchorId, position: "right" });
    }
    return insertAtRootEdge(grid, instanceId, "right");
  }));
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
 * edit places a pane that is not the window's. A pane opened there joins the
 * layout, under an id it did not hold. A pane the edit no longer places was
 * closed there and leaves the layout. Only the window's own instances take
 * the edit's changes, and none changes its pane type.
 */
export function applySecondaryWindowLayoutEdit(layout: LayoutConfig, edit: SecondaryWindowLayoutEdit): LayoutConfig | null {
  const windows = layout.windows ?? [];
  if (!windows.some((window) => window.id === edit.windowId)) return null;
  const current = secondaryWindowPaneIds(layout, edit.windowId);
  const currentIds = new Set(current);
  if (current.length !== edit.basePaneIds.length || edit.basePaneIds.some((id) => !currentIds.has(id))) return null;
  const incoming = [...getDockedInstanceIds(edit.dockRoot), ...edit.floating.map((entry) => entry.instanceId)];
  const incomingIds = new Set(incoming);
  // A pane opened in the window brings its instance, under an id the layout does not hold yet.
  const knownIds = new Set(layout.instances.map((instance) => instance.instanceId));
  const opened = edit.instances.filter((instance) => (
    incomingIds.has(instance.instanceId) && !knownIds.has(instance.instanceId) && typeof instance.paneId === "string"
  ));
  const openedIds = new Set(opened.map((instance) => instance.instanceId));
  if (incoming.some((id) => !currentIds.has(id) && !openedIds.has(id))) return null;
  const editedInstances = new Map(edit.instances
    .filter((instance) => incomingIds.has(instance.instanceId))
    .map((instance) => [instance.instanceId, instance] as const));
  const spliced: LayoutConfig = {
    ...layout,
    instances: [
      ...layout.instances.map((instance) => {
        const edited = editedInstances.get(instance.instanceId);
        return edited && currentIds.has(instance.instanceId)
          ? { ...edited, instanceId: instance.instanceId, paneId: instance.paneId }
          : instance;
      }),
      ...opened,
    ],
    windows: windows.map((window) => (
      window.id === edit.windowId ? { id: window.id, dockRoot: edit.dockRoot, floating: edit.floating } : window
    )),
  };
  const closed = current.filter((id) => !incomingIds.has(id));
  return finalizeLayout(closed.length > 0 ? removePaneInstances(spliced, closed) : spliced);
}
