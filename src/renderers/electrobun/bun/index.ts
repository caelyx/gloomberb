import Electrobun, { ApplicationMenu } from "electrobun/bun";
import { debugLog } from "../../../utils/debug-log";
import { setConfigStoreHost } from "../../../data/config/store";
import * as nodeConfigStoreHost from "../../../data/config/store/node";
import { ELECTROBUN_CONTEXT_MENU_ACTION } from "../shared/protocol";
import { contextMenuSelectionMessage } from "./context-menu/click";
import { applicationMenuCommand, createApplicationMenuGate } from "./application-menu/click";
import { DesktopBackend } from "./desktop/backend";
import {
  MAIN_WINDOW_MIN_SIZE,
  defaultMainWindowFrame,
  normalizeWindowFrameWithMinimum,
} from "./window/frame";
import { MAIN_WINDOW_RPC_KEY } from "./window/focus";
import { createAppWindow } from "./window/create";
import { readDisplayWorkAreas } from "./window/displays";
import {
  createRememberedWindowStore,
  fitWindowFrameToDisplays,
  rememberedDesktopWindowPath,
} from "./window/remembered-frame";
import { createRememberedWindowTracker, restoreWindowState } from "./window/remembered-tracker";
import { reapStaleTerminalMedia } from "../../opentui/terminal-media";
import { installProcessCrashListeners } from "../../../telemetry/crash-reports-node";

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

// The Bun process has no Debug pane. An error logged here, such as a plugin
// that failed to import, would otherwise be invisible outside the view's
// marketplace row; the launcher log is where a desktop user can look.
debugLog.mirrorToConsole({ minLevel: "error" });

setConfigStoreHost(nodeConfigStoreHost);

// Electrobun exits this process on an uncaught exception; the listener goes
// ahead of it and spools the report for the next launch. Nothing is sent
// before the config, and its off switch, has been read.
installProcessCrashListeners();

function readOpenUrlEvent(event: unknown): string | null {
  const data = event && typeof event === "object" ? (event as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  return typeof url === "string" && url ? url : null;
}

const rememberedWindows = createRememberedWindowStore(rememberedDesktopWindowPath());
const backend = new DesktopBackend(rememberedWindows);

Electrobun.events.on("context-menu-clicked", (event: unknown) => {
  const message = contextMenuSelectionMessage(event, ELECTROBUN_CONTEXT_MENU_ACTION);
  if (!message) return;
  backend.selectContextMenuItem(message);
});

Electrobun.events.on("open-url", (event: unknown) => {
  const url = readOpenUrlEvent(event);
  if (!url) return;
  backend.openDeepLink(url);
});

const applicationMenuMayRun = createApplicationMenuGate();
ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  const command = applicationMenuCommand(event);
  if (!command || !applicationMenuMayRun(command)) return;
  backend.runApplicationMenuCommand(command);
});

backend.installApplicationMenu();

// The desktop app never starts a terminal player, but it is usually the next
// thing launched after a terminal run left one behind, and until something
// reaps it that player keeps decoding video and flooding the terminal it was
// started from. Cleaning up here is what makes the stray actually die.
reapStaleTerminalMedia();

const mainRpc = backend.createWindowRpc(MAIN_WINDOW_RPC_KEY);
const rememberedWindow = rememberedWindows.main();
const initialMainWindowFrame = fitWindowFrameToDisplays(
  normalizeWindowFrameWithMinimum(rememberedWindow?.frame, defaultMainWindowFrame(), MAIN_WINDOW_MIN_SIZE),
  readDisplayWorkAreas(),
);
const mainWindowTracker = createRememberedWindowTracker({
  initialFrame: initialMainWindowFrame,
  getWindow: () => backend.mainWindow,
  save: (value) => rememberedWindows.saveMain(value),
});

const mainWindow = createAppWindow({
  title: "Gloomberb",
  frame: initialMainWindowFrame,
  rpc: mainRpc,
  minSize: MAIN_WINDOW_MIN_SIZE,
  onFrameChange: () => mainWindowTracker.schedule(),
});
backend.mainWindow = mainWindow;
backend.mainWindowTracker = mainWindowTracker;
restoreWindowState(mainWindow, rememberedWindow);
const mainWindowEvents = mainWindow as { on?: (event: string, listener: () => void) => void };
mainWindowEvents.on?.("focus", () => backend.noteWindowFocus(MAIN_WINDOW_RPC_KEY, true));
mainWindowEvents.on?.("blur", () => backend.noteWindowFocus(MAIN_WINDOW_RPC_KEY, false));
// The main window holds the state every other window shows, so closing it by
// its own button or Cmd-W quits the app rather than leaving them behind.
mainWindowEvents.on?.("close", () => {
  mainWindowTracker.flush();
  // Already closing: the exit must not close it a second time.
  if (backend.mainWindow === mainWindow) backend.mainWindow = null;
  backend.exitApp();
});
backend.focusWindowForRpcKey(MAIN_WINDOW_RPC_KEY);
