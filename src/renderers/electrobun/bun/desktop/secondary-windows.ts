import type { BrowserWindow } from "electrobun/bun";
import {
  DEFAULT_WINDOW_FRAME,
  MAIN_WINDOW_MIN_SIZE,
  normalizeWindowFrameWithMinimum,
  type WindowFrame,
} from "../window/frame";
import { secondaryWindowRpcKey, windowIdFromSecondaryRpcKey } from "../window/focus";
import { getWindowFrame } from "../window/events";
import { createAppWindow } from "../window/create";
import { readDisplayWorkAreas } from "../window/displays";
import { fitWindowFrameToDisplays, type DisplayWorkArea, type RememberedWindowStore } from "../window/remembered-frame";
import { createRememberedWindowTracker, restoreWindowState } from "../window/remembered-tracker";
import { secondaryWindowLabel } from "../../../../layout/pane-manager/secondary-windows";
import type { DesktopBackend } from "./backend";

/**
 * Where a window that has never been open goes: filling the first display
 * that is not the primary one, since a second window is for a second screen,
 * or beside the main window when there is only one display.
 */
function defaultSecondaryWindowFrame(displays: readonly DisplayWorkArea[], mainFrame: WindowFrame | null): WindowFrame {
  const secondary = displays.find((display) => !display.primary && display.width >= 1 && display.height >= 1);
  if (secondary) return { x: secondary.x, y: secondary.y, width: secondary.width, height: secondary.height };
  const anchor = mainFrame ?? DEFAULT_WINDOW_FRAME;
  return { x: anchor.x + 72, y: anchor.y + 72, width: anchor.width, height: anchor.height };
}

/** "w2" reads as "Window 2" in the Window menu and the window switcher, as in the app's own menus. */
function secondaryWindowTitle(windowId: string): string {
  return `Gloomberb – ${secondaryWindowLabel(windowId)}`;
}

/**
 * The native windows for the open layout tab's secondary windows: each one a
 * view of the shared state with its own grid. Windows open and close to match
 * the layout; one whose id the next tab also has stays open and shows that
 * tab's grid instead.
 */
export class DesktopSecondaryWindowManager {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly trackers = new Map<string, ReturnType<typeof createRememberedWindowTracker>>();
  /** Windows this process is closing, whose close must not move their panes. */
  private readonly closing = new Set<string>();
  /** Windows the user closed, still in the layout until the main window drops them. */
  private readonly closedByUser = new Set<string>();

  constructor(
    private readonly backend: DesktopBackend,
    private readonly remembered: RememberedWindowStore,
  ) {}

  getWindowForRpcKey(rpcKey: string | undefined): BrowserWindow | null {
    const windowId = windowIdFromSecondaryRpcKey(rpcKey);
    return windowId ? this.windows.get(windowId) ?? null : null;
  }

  focus(windowId: string): boolean {
    const window = this.windows.get(windowId);
    if (!window) return false;
    window.activate();
    return true;
  }

  reconcile(): void {
    const config = this.backend.config;
    if (!config) return;
    const desired = new Set((config.layout.windows ?? []).map((window) => window.id));
    for (const windowId of [...this.closedByUser]) {
      if (!desired.has(windowId)) this.closedByUser.delete(windowId);
    }
    for (const windowId of desired) {
      if (this.closedByUser.has(windowId)) continue;
      const existing = this.windows.get(windowId);
      if (existing) {
        (existing as { setTitle?: (title: string) => void }).setTitle?.(secondaryWindowTitle(windowId));
      } else {
        this.createWindow(windowId);
      }
    }
    for (const windowId of [...this.windows.keys()]) {
      if (!desired.has(windowId)) this.closeWindow(windowId);
    }
  }

  closeAll(): void {
    for (const windowId of [...this.windows.keys()]) this.closeWindow(windowId);
  }

  private closeWindow(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) return;
    this.closing.add(windowId);
    this.trackers.get(windowId)?.flush();
    this.cleanup(windowId);
    window.close();
  }

  private cleanup(windowId: string): void {
    const key = secondaryWindowRpcKey(windowId);
    this.backend.disposeWindowResources(key);
    this.backend.noteWindowFocus(key, false);
    this.backend.rpcs.unregisterWindowRpc(key);
    this.windows.delete(windowId);
    this.trackers.delete(windowId);
  }

  private createWindow(windowId: string): BrowserWindow {
    const key = secondaryWindowRpcKey(windowId);
    const rpc = this.backend.createWindowRpc(key);
    const remembered = this.remembered.window(windowId);
    const displays = readDisplayWorkAreas();
    const frame = fitWindowFrameToDisplays(
      normalizeWindowFrameWithMinimum(
        remembered?.frame,
        defaultSecondaryWindowFrame(displays, getWindowFrame(this.backend.mainWindow)),
        MAIN_WINDOW_MIN_SIZE,
      ),
      displays,
    );
    const tracker = createRememberedWindowTracker({
      initialFrame: frame,
      getWindow: () => this.windows.get(windowId) ?? null,
      save: (value) => this.remembered.saveWindow(windowId, value),
    });
    const window = createAppWindow({
      title: secondaryWindowTitle(windowId),
      frame,
      rpc: rpc as never,
      minSize: MAIN_WINDOW_MIN_SIZE,
      onFrameChange: () => tracker.schedule(),
    });
    this.windows.set(windowId, window);
    this.trackers.set(windowId, tracker);
    restoreWindowState(window, remembered);

    const events = window as { on?: (event: string, listener: () => void) => void };
    events.on?.("focus", () => this.backend.noteWindowFocus(key, true));
    events.on?.("blur", () => this.backend.noteWindowFocus(key, false));
    events.on?.("close", () => {
      const ours = this.closing.delete(windowId);
      if (!ours) tracker.flush();
      if (this.windows.get(windowId) === window) this.cleanup(windowId);
      // Closed by its own close button or Cmd-W: the main window moves its panes into its own grid.
      if (ours || this.backend.exiting) return;
      if (!this.backend.config?.layout.windows?.some((entry) => entry.id === windowId)) return;
      // Until the layout drops it, a state from before the close must not open it again.
      this.closedByUser.add(windowId);
      void this.backend.closeSecondaryWindowThroughMain(windowId);
    });
    return window;
  }
}
