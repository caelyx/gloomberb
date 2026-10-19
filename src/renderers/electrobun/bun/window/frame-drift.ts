import type { BrowserWindow } from "electrobun/bun";
import { updateWindowFrameCache } from "./events";
import type { WindowFrame, WindowMinimumSize } from "./frame";

const DRIFT_CHECK_DELAY_MS = 300;

/**
 * A stopgap from the macOS spike (docs/design/secondary-windows.md, §6a): a
 * window opened on a second display came back higher than the frame it was
 * given, twice by exactly the difference between the displays' heights, so
 * each relaunch crept it up the screen. The main window never moved. Until a
 * second spike run settles the cause, a newly opened secondary window reads
 * its frame back once and, if it is not where it was put, is put there again.
 * Adjust or remove this after that run.
 */
export function correctOpenedFrameOnce(window: BrowserWindow, requested: WindowFrame, minSize: WindowMinimumSize): void {
  setTimeout(() => {
    let actual: WindowFrame | null = null;
    try { actual = window.getFrame(); } catch { return; }
    try { if (window.isFullScreen() || window.isMaximized() || window.isMinimized()) return; } catch { return; }
    if (!actual || (actual.x === requested.x && actual.y === requested.y)) return;
    console.error("[desktop-window] corrected a secondary window's opening frame", { requested, actual });
    window.setFrame(requested.x, requested.y, requested.width, requested.height);
    updateWindowFrameCache(window, requested, minSize);
  }, DRIFT_CHECK_DELAY_MS);
}
