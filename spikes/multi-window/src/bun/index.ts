/**
 * Multi-window spike host. Answers, on a real Mac with two displays:
 *  1. Can each window go native full screen on its own display, and be restored that way at launch?
 *  2. Do Electrobun's native focus/blur events track the key window reliably, compared with DOM focus?
 *  3. Can a Cmd-K menu accelerator be routed to the focused window (not main), and does the
 *     webview also receive the keydown (double fire)?
 *  4. Does backtick reach the webview in every window without a menu accelerator?
 *
 * Everything observable is logged to stdout and to ~/gloomberb-multi-window-spike.log (JSON lines).
 */
import { ApplicationMenu, BrowserView, BrowserWindow, Screen, Utils } from "electrobun/bun";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DisplayInfo, HostState, Rect, SpikeRpcSchema, WindowKey, WindowStatus } from "../shared/rpc";

const LOG_PATH = join(homedir(), "gloomberb-multi-window-spike.log");
const FRAMES_PATH = join(homedir(), "gloomberb-multi-window-spike-frames.json");
const MENU_ACTION = "spike.menu";

// ---- logging ---------------------------------------------------------------

const startedAt = Date.now();
function log(event: string, detail?: unknown): void {
  const entry = { t: Date.now() - startedAt, event, ...(detail === undefined ? {} : { detail }) };
  const line = JSON.stringify(entry);
  console.log(line);
  try { appendFileSync(LOG_PATH, `${line}\n`); } catch { /* logging must never break the spike */ }
  for (const rpc of rpcs.values()) {
    try { rpc.send.hostLog({ line }); } catch { /* window may be closing */ }
  }
}

// ---- displays and remembered frames ---------------------------------------

function displays(): DisplayInfo[] {
  try { return Screen.getAllDisplays() as DisplayInfo[]; } catch { return []; }
}

function displayContaining(frame: Rect | null): DisplayInfo | null {
  if (!frame) return null;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  return displays().find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width
    && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height) ?? null;
}

interface RememberedWindow { frame: Rect; fullscreen: boolean }
type RememberedFrames = Partial<Record<WindowKey, RememberedWindow>>;

function readRemembered(): RememberedFrames {
  if (!existsSync(FRAMES_PATH)) return {};
  try { return JSON.parse(readFileSync(FRAMES_PATH, "utf8")) as RememberedFrames; } catch { return {}; }
}

const remembered: RememberedFrames = readRemembered();
/** Last windowed (not full screen) frame per window; a full-screen frame is never saved as the window size. */
const windowedFrames = new Map<WindowKey, Rect>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveFrames(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const next: RememberedFrames = { ...remembered };
    for (const [key, window] of windows) {
      const fullscreen = safeIsFullScreen(window);
      const live = safeFrame(window);
      if (!fullscreen && live) windowedFrames.set(key, live);
      const frame = windowedFrames.get(key);
      if (frame) next[key] = { frame, fullscreen };
    }
    Object.assign(remembered, next);
    try { writeFileSync(FRAMES_PATH, JSON.stringify(next, null, 2)); } catch { /* best effort */ }
    log("frames-saved", next);
  }, 400);
}

function defaultFrame(key: WindowKey): Rect {
  const all = displays();
  const primary = all.find((d) => d.isPrimary) ?? all[0];
  const secondary = all.find((d) => !d.isPrimary);
  const target = key === "w2" && secondary ? secondary : primary;
  if (!target) return { x: key === "main" ? 80 : 160, y: 80, width: 1100, height: 750 };
  const wa = target.workArea;
  const inset = key === "w2" && !secondary ? 80 : 40; // no second display: offset so both are visible
  return { x: wa.x + inset, y: wa.y + inset, width: Math.min(1100, wa.width - 80), height: Math.min(750, wa.height - 80) };
}

// ---- windows ---------------------------------------------------------------

type SpikeRpc = ReturnType<typeof BrowserView.defineRPC<SpikeRpcSchema>>;
const windows = new Map<WindowKey, BrowserWindow>();
const rpcs = new Map<WindowKey, SpikeRpc>();
const windowIdToKey = new Map<number, WindowKey>();
let nativeActive: WindowKey | null = null;
let domActive: WindowKey | null = null;

function safeFrame(window: BrowserWindow): Rect | null {
  try { return window.getFrame(); } catch { return null; }
}
function safeIsFullScreen(window: BrowserWindow): boolean {
  try { return window.isFullScreen() === true; } catch { return false; }
}

function hostState(): HostState {
  const statuses: WindowStatus[] = [...windows].map(([key, window]) => {
    const frame = safeFrame(window);
    return { key, frame, fullscreen: safeIsFullScreen(window), displayId: displayContaining(frame)?.id ?? null };
  });
  return { nativeActive, domActive, windows: statuses, displays: displays() };
}

function broadcastState(): void {
  const state = hostState();
  for (const rpc of rpcs.values()) {
    try { rpc.send.hostState(state); } catch { /* window may be closing */ }
  }
}

function otherKey(key: WindowKey): WindowKey {
  return key === "main" ? "w2" : "main";
}

function createRpc(key: WindowKey): SpikeRpc {
  const rpc = BrowserView.defineRPC<SpikeRpcSchema>({
    maxRequestTime: 10_000,
    handlers: {
      requests: {
        whoami: () => ({ key }),
        setFullScreen: ({ fullScreen }) => {
          const window = windows.get(key);
          if (!window) return false;
          log("request-set-fullscreen", { key, fullScreen });
          window.setFullScreen(fullScreen);
          checkFullScreenLater(key, `after setFullScreen(${fullScreen})`);
          return true;
        },
        moveToDisplay: ({ displayId }) => {
          const window = windows.get(key);
          const display = displays().find((d) => d.id === displayId);
          if (!window || !display) return false;
          const wa = display.workArea;
          const frame = { x: wa.x + 40, y: wa.y + 40, width: Math.min(1100, wa.width - 80), height: Math.min(750, wa.height - 80) };
          log("request-move-to-display", { key, displayId, frame });
          window.setFrame(frame.x, frame.y, frame.width, frame.height);
          setTimeout(broadcastState, 300);
          return true;
        },
        activateOther: () => {
          const other = windows.get(otherKey(key));
          log("request-activate-other", { from: key, to: otherKey(key), exists: !!other });
          other?.activate();
          return !!other;
        },
        openWindow2: () => {
          if (windows.has("w2")) {
            windows.get("w2")?.activate();
            return false;
          }
          openWindow("w2");
          return true;
        },
        closeSelf: () => {
          log("request-close-self", { key });
          windows.get(key)?.close();
          return true;
        },
        hostState: () => hostState(),
      },
      messages: {
        domFocus: ({ focused }) => {
          log(focused ? "dom-focus" : "dom-blur", { key, nativeActiveAtThisMoment: nativeActive });
          if (focused) domActive = key;
          else if (domActive === key) domActive = null;
          broadcastState();
        },
        log: ({ event, detail }) => {
          log(`view:${event}`, { key, nativeActive, domActive, ...(detail === undefined ? {} : { detail }) });
        },
      },
    },
  });
  rpcs.set(key, rpc);
  return rpc;
}

const fullScreenChecks = new Map<WindowKey, ReturnType<typeof setTimeout>>();
function checkFullScreenLater(key: WindowKey, reason: string): void {
  // Electrobun emits no fullscreen event; Gloomberb polls after resize settles. Check at 1s and 3s.
  for (const delay of [1000, 3000]) {
    setTimeout(() => {
      const window = windows.get(key);
      if (!window) return;
      const frame = safeFrame(window);
      log("fullscreen-check", { key, reason, delayMs: delay, isFullScreen: safeIsFullScreen(window), frame, displayId: displayContaining(frame)?.id ?? null });
      broadcastState();
    }, delay);
  }
}

function openWindow(key: WindowKey): BrowserWindow {
  const saved = remembered[key];
  const frame = saved?.frame ?? defaultFrame(key);
  const rpc = createRpc(key);
  const window = new BrowserWindow({
    title: key === "main" ? "Spike – main" : "Spike – window 2",
    frame,
    url: "views://mainview/index.html",
    renderer: "native",
    rpc,
    titleBarStyle: "hiddenInset", // what Gloomberb uses on macOS
  });
  windows.set(key, window);
  windowIdToKey.set(window.id, key);
  windowedFrames.set(key, frame);
  log("window-created", { key, windowId: window.id, frame, restoredFrom: saved ? FRAMES_PATH : "default", displayId: displayContaining(frame)?.id ?? null });

  window.on("focus", () => {
    nativeActive = key;
    log("native-focus", { key });
    broadcastState();
  });
  window.on("blur", () => {
    if (nativeActive === key) nativeActive = null;
    log("native-blur", { key });
    broadcastState();
  });
  window.on("keyDown", (event: unknown) => {
    const data = (event as { data?: unknown }).data;
    log("native-keydown", { key, data });
  });
  window.on("move", () => { scheduleSaveFrames(); });
  window.on("resize", () => {
    scheduleSaveFrames();
    // Mirrors Gloomberb's approach: ask after the size settles.
    const pending = fullScreenChecks.get(key);
    if (pending) clearTimeout(pending);
    fullScreenChecks.set(key, setTimeout(() => {
      fullScreenChecks.delete(key);
      log("resize-settled", { key, isFullScreen: safeIsFullScreen(window), frame: safeFrame(window) });
      broadcastState();
    }, 150));
  });
  window.on("close", () => {
    log("window-closed", { key });
    windows.delete(key);
    rpcs.delete(key);
    if (nativeActive === key) nativeActive = null;
    if (domActive === key) domActive = null;
    broadcastState();
  });

  if (saved?.fullscreen) {
    // Same as Gloomberb's main window today: restore immediately after creation.
    log("restore-fullscreen-immediate", { key });
    try { window.setFullScreen(true); } catch (error) { log("restore-fullscreen-error", { key, error: String(error) }); }
    checkFullScreenLater(key, "restore at launch");
  }
  return window;
}

// ---- application menu ------------------------------------------------------

ApplicationMenu.setApplicationMenu([
  {
    label: "GloomMultiWindowSpike",
    submenu: [
      { role: "about" },
      { type: "divider" },
      { label: "Quit Spike", action: MENU_ACTION, data: { command: "quit" }, accelerator: "CmdOrCtrl+Q" },
    ],
  },
  {
    label: "File",
    submenu: [
      // Same shape as Gloomberb: no accelerator for backtick (a bare key would swallow the character).
      { label: "Search Ticker...", action: MENU_ACTION, data: { command: "ticker-search" } },
      { label: "Open Window 2", action: MENU_ACTION, data: { command: "open-window-2" }, accelerator: "CmdOrCtrl+Shift+N" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" }, { role: "redo" }, { type: "divider" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      // Same accelerator string Gloomberb serialises for the command-bar action.
      { label: "Open Command Bar", action: MENU_ACTION, data: { command: "command-bar" }, accelerator: "CmdOrCtrl+K" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize" }, { role: "zoom" }, { type: "divider" },
      { role: "toggleFullScreen" }, { type: "divider" },
      { role: "close" }, { type: "divider" }, { role: "bringAllToFront" },
    ],
  },
]);

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  // Electrobun wraps the `{action, data}` payload in an event's `data`; accept a bare payload too.
  type Payload = { action?: string; data?: { command?: string } };
  const wrapped = (event as { data?: Payload }).data;
  const data = typeof wrapped?.action === "string" ? wrapped : (event as Payload);
  if (data?.action !== MENU_ACTION) return;
  const command = data.data?.command;
  log("menu-clicked", { command, nativeActive, domActive });
  switch (command) {
    case "quit":
      Utils.quit();
      return;
    case "open-window-2":
      if (windows.has("w2")) windows.get("w2")?.activate();
      else openWindow("w2");
      return;
    case "command-bar":
    case "ticker-search": {
      // The behaviour under test: route to the key window, and do NOT raise main.
      const target = nativeActive ?? domActive ?? "main";
      const rpc = rpcs.get(target);
      log("menu-routed", { command, target, via: nativeActive ? "native-focus" : domActive ? "dom-focus" : "fallback-main" });
      rpc?.send.menuCommand({ command, nativeActive });
      return;
    }
  }
});

// ---- start -----------------------------------------------------------------

log("spike-start", { displays: displays(), remembered, logPath: LOG_PATH, framesPath: FRAMES_PATH });
openWindow("main");
openWindow("w2");
setTimeout(broadcastState, 1000);
