import type { PaneRuntimeState } from "../../../../../core/state/app/state";
import type {
  DesktopDockPreviewState,
  DesktopSharedStateSnapshot,
  DesktopThemePreviewState,
  DesktopWindowBridge,
  DesktopWindowIntent,
  DesktopWindowIntentResult,
} from "../../../../../types/desktop-window";
import {
  backendRequest,
  getElectrobunBackendInitSnapshot,
  onBackendMessage,
  setElectrobunWindowIntentHandler,
} from "../../backend-rpc";
import { detachedRpcKey, MAIN_WINDOW_RPC_KEY, secondaryWindowRpcKey } from "../../../shared/window-keys";
import { createDetachedSnapshotFilter, prepareSecondaryWindowSnapshot } from "./snapshot";

function windowKeyFor(kind: DesktopWindowBridge["kind"], paneId?: string, windowId?: string): string | undefined {
  if (kind === "main") return MAIN_WINDOW_RPC_KEY;
  if (kind === "window") return windowId ? secondaryWindowRpcKey(windowId) : undefined;
  return paneId ? detachedRpcKey(paneId) : undefined;
}

export function createDesktopWindowBridge(
  kind: DesktopWindowBridge["kind"],
  paneId?: string,
  windowId?: string,
): DesktopWindowBridge {
  const initialDesktopSnapshot = getElectrobunBackendInitSnapshot()?.desktopSnapshot ?? null;
  const takeDetachedSnapshot = kind === "detached" && paneId
    ? createDetachedSnapshotFilter(paneId, initialDesktopSnapshot)
    : null;

  return {
    kind,
    paneId,
    windowId,
    windowKey: windowKeyFor(kind, paneId, windowId),
    initialActiveWindowKey: getElectrobunBackendInitSnapshot()?.activeWindowKey ?? null,
    subscribeActiveWindow(listener: (windowKey: string | null) => void) {
      return onBackendMessage("desktop.activeWindow", (message) => {
        listener(message.windowKey);
      });
    },
    focusPaneInItsWindow: kind === "detached"
      ? undefined
      : async (targetPaneId: string) => {
        await backendRequest("window.focusPane", { paneId: targetPaneId });
      },
    focusWindow: kind === "detached"
      ? undefined
      : async (targetWindowId: string, targetPaneId?: string | null) => {
        await backendRequest("window.focus", { windowId: targetWindowId, paneId: targetPaneId ?? null });
      },
    subscribeFocusPane: kind === "detached"
      ? undefined
      : (listener: (paneId: string) => void) => onBackendMessage("desktop.focusPane", (message) => {
        listener(message.paneId);
      }),
    sendWindowIntent: kind === "window"
      ? (intent: DesktopWindowIntent) => backendRequest("window.intent", { intent })
      : undefined,
    handleWindowIntents: kind === "main"
      ? (handler: (windowId: string, intent: DesktopWindowIntent) => DesktopWindowIntentResult) => setElectrobunWindowIntentHandler(handler)
      : undefined,
    syncMainState: kind === "main"
      ? async (snapshot: DesktopSharedStateSnapshot) => {
        await backendRequest("desktop.syncMainState", { snapshot });
      }
      : undefined,
    syncThemePreview: kind === "main"
      ? async (preview: DesktopThemePreviewState) => {
        await backendRequest("desktop.setThemePreview", { preview });
      }
      : undefined,
    replaceDetachedPaneState: kind === "detached"
      ? async (targetPaneId: string, paneState: PaneRuntimeState) => {
        await backendRequest("desktop.replaceDetachedPaneState", { paneId: targetPaneId, paneState });
      }
      : undefined,
    popOutPane: async (targetPaneId: string) => {
      await backendRequest("desktop.popOutPane", { paneId: targetPaneId });
    },
    dockDetachedPane: async (targetPaneId: string) => {
      await backendRequest("desktop.dockDetachedPane", { paneId: targetPaneId });
    },
    closeDetachedPane: async (targetPaneId: string) => {
      await backendRequest("desktop.closeDetachedPane", { paneId: targetPaneId });
    },
    focusDetachedPane: async (targetPaneId: string) => {
      await backendRequest("desktop.focusDetachedPane", { paneId: targetPaneId });
    },
    subscribeState(listener: (snapshot: DesktopSharedStateSnapshot) => void) {
      return onBackendMessage("desktop.state", (message) => {
        if (takeDetachedSnapshot) {
          const snapshot = takeDetachedSnapshot(message.snapshot);
          if (snapshot) listener(snapshot);
          return;
        }
        // A secondary window takes every change: any pane in its grid, or the
        // grid itself, can move with one.
        listener(kind === "window" && windowId ? prepareSecondaryWindowSnapshot(message.snapshot, windowId) : message.snapshot);
      });
    },
    subscribeDockPreview(listener: (preview: DesktopDockPreviewState) => void) {
      return onBackendMessage("desktop.dockPreview", (message) => {
        listener(message.preview);
      });
    },
    subscribeThemePreview(listener: (preview: DesktopThemePreviewState) => void) {
      return onBackendMessage("desktop.themePreview", (message) => {
        listener(message.preview);
      });
    },
  };
}
