import type { PaneRuntimeState } from "../core/state/app/state";
import type { SecondaryWindowLayoutEdit, WindowMoveTarget, WindowSize } from "../layout/pane-manager/secondary-windows";
import type { AppConfig, PaneInstanceConfig } from "./config";

export interface DesktopSharedStateSnapshot {
  config: AppConfig;
  paneState: Record<string, PaneRuntimeState>;
  focusedPaneId: string | null;
  /** @deprecated Ignored and no longer sent. */
  activePanel?: "left" | "right";
  statusBarVisible: boolean;
  mainStateRevision?: number;
  layoutChanged?: boolean;
}

export interface DesktopDockPreviewState {
  paneId: string | null;
  edge: "left" | "right" | "top" | "bottom" | null;
}

export interface DesktopThemePreviewState {
  theme: string | null;
}

/**
 * A change a secondary window asks the main window to make. The main window is
 * the only one that writes layout and config, so its revisions order every
 * change; the host tells it which window asked, and it applies the change to
 * that window's panes only.
 */
export type DesktopWindowIntent =
  | { type: "editLayout"; edit: SecondaryWindowLayoutEdit }
  | { type: "replacePaneState"; paneState: Record<string, PaneRuntimeState> }
  /** Plugin settings a pane changed, by plugin; null removes that plugin's settings. */
  | { type: "setPluginConfig"; values: Record<string, Record<string, unknown> | null> }
  /**
   * App settings changed in the window, such as the theme or base currency:
   * only the fields that changed there. The main window takes the ones a
   * window may set and ignores the rest.
   */
  | { type: "setConfig"; fields: Partial<AppConfig> }
  /**
   * Panes in other windows that this window changed, as reusing one from its
   * command bar retargets it. Their places stay as they are.
   */
  | { type: "updateInstances"; instances: PaneInstanceConfig[] }
  /** One of the window's own panes to another window: "main", a window id, or "new". */
  | { type: "movePane"; paneId: string; target: WindowMoveTarget }
  /** A new, empty secondary window. */
  | { type: "addWindow" }
  /** This window gone, its panes moved into the main window. */
  | { type: "closeWindow" }
  /**
   * What the main window needs to place a pane moved here: the window's
   * focused pane and its size. Not a change; it is kept, not saved.
   */
  | { type: "windowStatus"; status: SecondaryWindowStatus };

/** A secondary window's focused pane and size, as it last told the main window. */
export interface SecondaryWindowStatus {
  focusedPaneId: string | null;
  size: WindowSize | null;
}

export interface DesktopWindowIntentResult {
  /** False when the main window dropped the change, for instance an edit made on a state it has since moved past. */
  applied: boolean;
}

export interface DesktopWindowBridge {
  /** The main window, a popped-out pane, or a secondary window with its own grid. */
  kind: "main" | "detached" | "window";
  paneId?: string;
  /** A secondary window's layout window id. */
  windowId?: string;
  /** This window's channel key, as `subscribeActiveWindow` reports windows. */
  windowKey?: string;
  /** The window with native focus when this one opened, or the last one to have it. */
  initialActiveWindowKey?: string | null;
  /** Native focus moving between this app's windows; it keeps the last one while the app is in the background. */
  subscribeActiveWindow?(listener: (windowKey: string | null) => void): () => void;
  /** A pane in another window: that window comes forward and focuses it. */
  focusPaneInItsWindow?(paneId: string): Promise<void>;
  /**
   * Window `windowId` ("main" or a layout window id) comes forward, focusing
   * `paneId` there once the layout has it there.
   */
  focusWindow?(windowId: string, paneId?: string | null): Promise<void>;
  /** The host asking this window to focus one of its own panes. */
  subscribeFocusPane?(listener: (paneId: string) => void): () => void;
  /** From a secondary window: a change for the main window to apply. */
  sendWindowIntent?(intent: DesktopWindowIntent): Promise<DesktopWindowIntentResult>;
  /** In the main window: applies the changes secondary windows ask for. */
  handleWindowIntents?(handler: (windowId: string, intent: DesktopWindowIntent) => DesktopWindowIntentResult): () => void;
  syncMainState?(snapshot: DesktopSharedStateSnapshot): Promise<void>;
  syncThemePreview?(preview: DesktopThemePreviewState): Promise<void>;
  replaceDetachedPaneState?(paneId: string, paneState: PaneRuntimeState): Promise<void>;
  popOutPane?(paneId: string): Promise<void>;
  dockDetachedPane?(paneId: string): Promise<void>;
  closeDetachedPane?(paneId: string): Promise<void>;
  focusDetachedPane?(paneId: string): Promise<void>;
  subscribeState(listener: (snapshot: DesktopSharedStateSnapshot) => void): () => void;
  subscribeDockPreview?(listener: (preview: DesktopDockPreviewState) => void): () => void;
  subscribeThemePreview?(listener: (preview: DesktopThemePreviewState) => void): () => void;
}
