import { describe, expect, test } from "bun:test";
import { nativeSetFrameY, type ScreenBounds } from "./native-frame";

// The displays from the macOS spike: an 1800-point primary and a 1692-point
// display to its right, its top 173 points lower.
const SCREENS: ScreenBounds[] = [
  { x: 0, y: 0, width: 3200, height: 1800, primary: true },
  { x: 3200, y: 173, width: 3008, height: 1692, primary: false },
];

describe("nativeSetFrameY", () => {
  test("undoes Electrobun flipping y against the window's own, shorter display", () => {
    const onSecondary = { x: 3201, y: 500, width: 1148, height: 1053 };
    // setFrame on that display would land 108 points low; ask 108 higher.
    expect(nativeSetFrameY(onSecondary, onSecondary, SCREENS)).toBe(392);
  });

  test("uses the display the window is on now, not the one it is going to", () => {
    const target = { x: 3300, y: 400, width: 1000, height: 800 };
    const onPrimary = { x: 100, y: 100, width: 1000, height: 800 };
    expect(nativeSetFrameY(target, onPrimary, SCREENS)).toBe(400);
    expect(nativeSetFrameY(onPrimary, target, SCREENS)).toBe(-8);
  });

  test("leaves y alone on the primary display, or with no display information", () => {
    const frame = { x: 40, y: 71, width: 1100, height: 750 };
    expect(nativeSetFrameY(frame, frame, SCREENS)).toBe(71);
    expect(nativeSetFrameY(frame, frame, [])).toBe(71);
  });
});
