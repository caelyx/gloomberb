import type { LayoutConfig } from "../../types/config";
import { getDockLeafLayouts, type LayoutBounds } from "./dock-tree";

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
