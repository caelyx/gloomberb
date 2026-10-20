import { Screen, type BrowserWindow } from "electrobun/bun";
import type { WindowFrame } from "./frame";

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

function overlapArea(frame: WindowFrame, screen: ScreenBounds): number {
  const width = Math.min(frame.x + frame.width, screen.x + screen.width) - Math.max(frame.x, screen.x);
  const height = Math.min(frame.y + frame.height, screen.y + screen.height) - Math.max(frame.y, screen.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The y to pass Electrobun's `setFrame` so a window lands at `frame.y`.
 *
 * Electrobun 1.18.1 on macOS flips y against two different heights: creating a
 * window and its move and resize events use the primary display's height, so
 * those frames are true top-left coordinates, but `setFrame` flips against the
 * height of the display the window is on now (`[window screen]`). On a display
 * shorter or taller than the primary the window lands off by the difference,
 * 108 points on a 1692-point display beside an 1800-point one. This undoes
 * that, using the display the window overlaps most, as AppKit picks it.
 */
export function nativeSetFrameY(frame: WindowFrame, current: WindowFrame, screens: readonly ScreenBounds[]): number {
  const primary = screens.find((screen) => screen.primary) ?? screens[0];
  if (!primary) return frame.y;
  let onScreen = primary;
  let best = 0;
  for (const screen of screens) {
    const area = overlapArea(current, screen);
    if (area > best) {
      best = area;
      onScreen = screen;
    }
  }
  return frame.y + onScreen.height - primary.height;
}

function readScreenBounds(): ScreenBounds[] {
  try {
    return Screen.getAllDisplays().map((display) => ({ ...display.bounds, primary: display.isPrimary }));
  } catch {
    return [];
  }
}

/**
 * Moves a window to a frame in the same top-left coordinates its move and
 * resize events report, and keeps the cached frame on those coordinates
 * rather than the compensated ones handed to the native call.
 */
export function setWindowFrame(window: BrowserWindow, frame: WindowFrame): void {
  const current = window.frame ?? frame;
  const y = process.platform === "darwin" ? nativeSetFrameY(frame, current, readScreenBounds()) : frame.y;
  window.setFrame(frame.x, y, frame.width, frame.height);
  window.frame = { ...frame };
}
