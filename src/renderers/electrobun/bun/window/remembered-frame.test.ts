import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createRememberedWindowStore,
  fitWindowFrameToDisplays,
  parseRememberedDesktopWindow,
  readRememberedDesktopWindows,
  rememberedDesktopWindowPath,
} from "./remembered-frame";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("remembered desktop window", () => {
  test("reads a saved frame and ignores a broken file", () => {
    const saved = {
      frame: { x: 120, y: 80, width: 1100, height: 700 },
      maximized: true,
      fullscreen: false,
    };
    expect(parseRememberedDesktopWindow(saved)).toEqual(saved);
    expect(parseRememberedDesktopWindow({ frame: { x: 1, y: 2, width: 0, height: 10 } })).toBeNull();
    expect(parseRememberedDesktopWindow({ x: 1 })).toBeNull();
    expect(parseRememberedDesktopWindow(null)).toBeNull();

    const directory = mkdtempSync(join(tmpdir(), "gloomberb-window-"));
    directories.push(directory);
    const path = join(directory, "desktop-window.json");
    expect(readRememberedDesktopWindows(path)).toEqual({ main: null, windows: {} });
    expect(rememberedDesktopWindowPath({ GLOOMBERB_HOME: directory, HOME: directory })).toBe(path);
  });

  test("keeps the main window's file format and adds secondary windows beside it", () => {
    const directory = mkdtempSync(join(tmpdir(), "gloomberb-window-"));
    directories.push(directory);
    const path = join(directory, "desktop-window.json");
    const main = { frame: { x: 0, y: 25, width: 1400, height: 860 }, maximized: false, fullscreen: true };
    // A file written before secondary windows existed reads as the main window alone.
    writeFileSync(path, JSON.stringify(main));
    expect(readRememberedDesktopWindows(path)).toEqual({ main, windows: {} });

    const store = createRememberedWindowStore(path);
    const second = { frame: { x: 3200, y: 204, width: 1100, height: 750 }, maximized: false, fullscreen: true };
    store.saveWindow("w2", second);
    expect(store.window("w2")).toEqual(second);
    expect(store.window("w3")).toBeNull();
    // The main window's fields stay at the top level, where older builds read them.
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject(main);
    expect(createRememberedWindowStore(path).window("w2")).toEqual(second);
    expect(createRememberedWindowStore(path).main()).toEqual(main);

    // A broken window entry is dropped without losing the rest.
    writeFileSync(path, JSON.stringify({ ...main, windows: { w2: second, w3: { frame: { x: 1 } }, "": second } }));
    expect(readRememberedDesktopWindows(path)).toEqual({ main, windows: { w2: second } });
  });

  test("keeps a frame that still sits on a display", () => {
    const frame = { x: 200, y: 100, width: 900, height: 600 };
    expect(fitWindowFrameToDisplays(frame, [
      { x: 0, y: 0, width: 1440, height: 900, primary: true },
    ])).toEqual(frame);
  });

  test("moves a frame off a missing display onto the one that remains", () => {
    expect(fitWindowFrameToDisplays(
      { x: 2000, y: 40, width: 800, height: 500 },
      [{ x: 0, y: 25, width: 1440, height: 875, primary: true }],
    )).toEqual({ x: 0, y: 40, width: 800, height: 500 });
  });

  test("shrinks a frame that is taller than the display it landed on", () => {
    expect(fitWindowFrameToDisplays(
      { x: 10, y: 10, width: 2000, height: 1400 },
      [{ x: 0, y: 0, width: 1280, height: 800, primary: true }],
    )).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  test("leaves the frame alone when no display size is known", () => {
    const frame = { x: -40, y: 12, width: 700, height: 400 };
    expect(fitWindowFrameToDisplays(frame, [])).toEqual(frame);
    expect(fitWindowFrameToDisplays(frame, [{ x: 0, y: 0, width: 0, height: 0 }])).toEqual(frame);
  });
});
