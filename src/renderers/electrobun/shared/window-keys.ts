/** Each window's channel key, which the host and the windows' views both name windows by. */
export const MAIN_WINDOW_RPC_KEY = "main";

const DETACHED_WINDOW_RPC_PREFIX = "detached:";
const SECONDARY_WINDOW_RPC_PREFIX = "window:";

export function detachedRpcKey(instanceId: string): string {
  return `${DETACHED_WINDOW_RPC_PREFIX}${instanceId}`;
}

export function paneIdFromDetachedRpcKey(rpcKey: string | undefined): string | null {
  if (!rpcKey?.startsWith(DETACHED_WINDOW_RPC_PREFIX)) return null;
  return rpcKey.slice(DETACHED_WINDOW_RPC_PREFIX.length) || null;
}

/** The channel of the secondary window that shows layout window `windowId`. */
export function secondaryWindowRpcKey(windowId: string): string {
  return `${SECONDARY_WINDOW_RPC_PREFIX}${windowId}`;
}

export function windowIdFromSecondaryRpcKey(rpcKey: string | undefined): string | null {
  if (!rpcKey?.startsWith(SECONDARY_WINDOW_RPC_PREFIX)) return null;
  return rpcKey.slice(SECONDARY_WINDOW_RPC_PREFIX.length) || null;
}

/** Where a pane is, as `findPaneLocation` reports it. */
interface PaneWindowLocation {
  window: string;
  kind: "docked" | "floating" | "detached";
}

/** The channel of the window that shows a pane, or null when no window does. */
export function paneWindowRpcKey(paneId: string, location: PaneWindowLocation | null): string | null {
  if (!location) return null;
  if (location.kind === "detached") return detachedRpcKey(paneId);
  return location.window === "main" ? MAIN_WINDOW_RPC_KEY : secondaryWindowRpcKey(location.window);
}

/**
 * The window a menu command that opens the bar goes to: the secondary window
 * last in front, so the bar opens where the user is, else the main window. A
 * popped-out pane has no bar, and forms submit through the main window's state.
 */
export function commandBarMenuTarget(lastActiveWindowKey: string | null, isReady: (windowKey: string) => boolean): string {
  return lastActiveWindowKey && windowIdFromSecondaryRpcKey(lastActiveWindowKey) && isReady(lastActiveWindowKey)
    ? lastActiveWindowKey
    : MAIN_WINDOW_RPC_KEY;
}
