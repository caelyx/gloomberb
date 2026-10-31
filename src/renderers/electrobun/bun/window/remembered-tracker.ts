import type { BrowserWindow } from "electrobun/bun";
import { getWindowFrame } from "./events";
import type { WindowFrame } from "./frame";
import type { RememberedDesktopWindow } from "./remembered-frame";

const REMEMBER_DELAY_MS = 300;

/**
 * Keeps one window's last frame and state saved as it moves. A minimised
 * window is not saved, and while it is full screen or maximised the frame it
 * had before is kept, so leaving that state puts it back where it was.
 */
export function createRememberedWindowTracker(options: {
  initialFrame: WindowFrame;
  getWindow: () => BrowserWindow | null;
  save: (value: RememberedDesktopWindow) => void;
}) {
  let windowedFrame = options.initialFrame;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const read = (): RememberedDesktopWindow | null => {
    const window = options.getWindow();
    if (!window) return null;
    const live = getWindowFrame(window) ?? windowedFrame;
    let minimized = false;
    let fullscreen = false;
    let maximized = false;
    try { minimized = window.isMinimized() === true; } catch { minimized = false; }
    if (minimized) return null;
    try { fullscreen = window.isFullScreen() === true; } catch { fullscreen = false; }
    try { maximized = !fullscreen && window.isMaximized() === true; } catch { maximized = false; }
    if (!fullscreen && !maximized) windowedFrame = live;
    return { frame: windowedFrame, maximized, fullscreen };
  };

  const write = () => {
    const next = read();
    if (next) options.save(next);
  };

  return {
    schedule(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        write();
      }, REMEMBER_DELAY_MS);
    },
    flush(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
  };
}

/** Puts a restored window back into full screen or maximised, as it was left. */
export function restoreWindowState(window: BrowserWindow, remembered: RememberedDesktopWindow | null): void {
  if (remembered?.fullscreen) {
    try { window.setFullScreen(true); } catch { /* the framed window is still the one they sized */ }
  } else if (remembered?.maximized) {
    try { window.maximize(); } catch { /* the framed window is still the one they sized */ }
  }
}
