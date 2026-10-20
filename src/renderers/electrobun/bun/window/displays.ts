import { Screen } from "electrobun/bun";
import type { DisplayWorkArea } from "./remembered-frame";

/** The connected displays' usable areas, or none when the native library cannot say. */
export function readDisplayWorkAreas(): DisplayWorkArea[] {
  try {
    return Screen.getAllDisplays().map((display) => ({
      x: display.workArea?.x ?? display.bounds.x,
      y: display.workArea?.y ?? display.bounds.y,
      width: display.workArea?.width ?? display.bounds.width,
      height: display.workArea?.height ?? display.bounds.height,
      primary: display.isPrimary,
    }));
  } catch {
    return [];
  }
}
