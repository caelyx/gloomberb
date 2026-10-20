import type { PaneRuntimeState } from "../../../../../core/state/app/state";
import type {
  DesktopDockPreviewState,
  DesktopSharedStateSnapshot,
  DesktopThemePreviewState,
  DesktopWindowBridge,
} from "../../../../../types/desktop-window";
import { backendRequest, getElectrobunBackendInitSnapshot, onBackendMessage } from "../../backend-rpc";
import { detachedSnapshotKey, prepareDetachedSnapshot, prepareSecondaryWindowSnapshot } from "./snapshot";

export function createDesktopWindowBridge(
  kind: DesktopWindowBridge["kind"],
  paneId?: string,
  windowId?: string,
): DesktopWindowBridge {
  const initialDesktopSnapshot = getElectrobunBackendInitSnapshot()?.desktopSnapshot ?? null;
  let lastDetachedSnapshotKey = kind === "detached" && paneId && initialDesktopSnapshot
    ? detachedSnapshotKey(initialDesktopSnapshot, paneId)
    : null;

  return {
    kind,
    paneId,
    windowId,
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
    movePaneToNewWindow: kind === "main"
      ? async (targetPaneId: string) => {
        await backendRequest("desktop.movePaneToNewWindow", { paneId: targetPaneId });
      }
      : undefined,
    movePaneToMainWindow: kind === "window"
      ? async (targetPaneId: string) => {
        await backendRequest("desktop.movePaneToMainWindow", { paneId: targetPaneId });
      }
      : undefined,
    subscribeState(listener: (snapshot: DesktopSharedStateSnapshot) => void) {
      return onBackendMessage("desktop.state", (message) => {
        if (kind === "detached" && paneId) {
          const nextKey = detachedSnapshotKey(message.snapshot, paneId);
          if (nextKey === lastDetachedSnapshotKey) return;
          lastDetachedSnapshotKey = nextKey;
          listener(prepareDetachedSnapshot(message.snapshot, paneId));
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
