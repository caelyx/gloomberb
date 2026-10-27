import { createContext, useContext } from "react";
import type { WindowMoveTarget, WindowSize } from "../../../layout/pane-manager/secondary-windows";

/**
 * Moving panes between the desktop app's windows, and making, closing and
 * raising windows. The main window applies each change itself; a secondary
 * window asks the main window to.
 */
export interface DesktopWindowCommands {
  /** The layout window this is; null for the main window. */
  windowId: string | null;
  /** A pane to the main window ("main"), another window by id, or a new one ("new"). */
  movePaneToWindow(paneId: string, target: WindowMoveTarget): void;
  /** A new, empty secondary window. */
  addWindow(): void;
  /** This secondary window gone, its panes moved into the main window; absent in the main window. */
  closeWindow?: () => void;
  /** Window `windowId` ("main" or a layout window id) brought forward. */
  focusWindow(windowId: string): void;
  /** This window's size in cells, as its grid lays out, so a floating pane moved here keeps its proportions. */
  noteWindowSize(size: WindowSize): void;
}

export const DesktopWindowCommandsContext = createContext<DesktopWindowCommands | null>(null);

/** The window commands, in the desktop app's main and secondary windows; null anywhere else. */
export function useDesktopWindowCommands(): DesktopWindowCommands | null {
  return useContext(DesktopWindowCommandsContext);
}
