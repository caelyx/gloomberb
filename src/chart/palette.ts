// Landscape colours by meaning, shared with tools/landscape_plot.py through
// landscape-palette.json. Theme tokens are too few and too alike (the default
// theme's "neutral" is the same grey as dim text), so the chart carries its
// own hues: one per technology, and two strong ones, apart from all four, for
// the RSA-2048 and ECC-256 estimates. Each has a dark-page and a light-page
// form; palette.test.ts holds them to a minimum CIEDE2000 distance.
import COLOURS from "./landscape-palette.json";

export type LandscapeTone = "dark" | "light";

export interface ToneColours {
  modality: Record<string, string>;
  rsa2048: string;
  ecc256: string;
}

export const LANDSCAPE_COLOURS: Record<LandscapeTone, ToneColours> = COLOURS;

/** Which set suits a page: by its relative luminance (WCAG). */
export function landscapeTone(page: string): LandscapeTone {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(page.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "light" : "dark";
}
