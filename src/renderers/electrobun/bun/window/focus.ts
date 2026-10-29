import { MAIN_WINDOW_RPC_KEY, paneIdFromDetachedRpcKey } from "../../shared/window-keys";

export {
  MAIN_WINDOW_RPC_KEY,
  detachedRpcKey,
  paneIdFromDetachedRpcKey,
  secondaryWindowRpcKey,
  windowIdFromSecondaryRpcKey,
} from "../../shared/window-keys";

export interface FocusableElectrobunWindow {
  activate?: () => void;
  focus?: () => void;
}

function resolveWindowForRpcKey<T>(
  rpcKey: string | undefined,
  mainWindow: T | null,
  detachedWindows: ReadonlyMap<string, T>,
): T | null {
  if (rpcKey === MAIN_WINDOW_RPC_KEY) return mainWindow;
  const paneId = paneIdFromDetachedRpcKey(rpcKey);
  return paneId ? detachedWindows.get(paneId) ?? null : null;
}

export function focusWindowForRpcKey(
  rpcKey: string | undefined,
  mainWindow: FocusableElectrobunWindow | null,
  detachedWindows: ReadonlyMap<string, FocusableElectrobunWindow>,
): boolean {
  const window = resolveWindowForRpcKey(rpcKey, mainWindow, detachedWindows);
  if (window?.activate) {
    window.activate();
    return true;
  }
  if (!window?.focus) return false;
  window.focus();
  return true;
}
