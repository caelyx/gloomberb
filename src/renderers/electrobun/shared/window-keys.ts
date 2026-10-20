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
