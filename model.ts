import type { Density, Headline } from "./types";

/**
 * Nothing here imports from the host: the encoding is the part worth testing,
 * and keeping it pure lets `bun test` run without a Gloomberb checkout. The
 * pane passes the live theme in as a palette.
 */
export interface TilePalette {
  bg: string;
  text: string;
  textBright: string;
  selected: string;
  selectedText: string;
}

// ---------------------------------------------------------------- size

/**
 * Newsmap sizes a story by its standing in the section's feed. Google News
 * gives us two signals for that: the position it ranked the story at, and how
 * many outlets it clustered under it. Neither is a number we can add up, so
 * this is a shape chosen to look right — a slow decay down the feed, lifted by
 * a story several outlets are running.
 */
const RANK_DECAY = 0.78;
const CLUSTER_STEP = 0.18;
const MAX_CLUSTER = 5;

export function storyWeight(headline: Headline): number {
  const base = 1 / Math.pow(headline.rank + 2, RANK_DECAY);
  const cluster = 1 + CLUSTER_STEP * Math.min(Math.max(headline.relatedCount, 0), MAX_CLUSTER);
  return base * cluster;
}

// ---------------------------------------------------------------- age

/**
 * A half-life rather than a linear ramp: on a busy feed most stories land in
 * the last few hours, and a linear ramp over a day leaves them all the same
 * shade. Six hours keeps the top of the map moving visibly.
 */
const FRESHNESS_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

export function freshness(publishedAt: number, now: number): number {
  const age = now - publishedAt;
  if (!Number.isFinite(age)) return 1;
  if (age <= 0) return 1;
  return clamp(Math.pow(2, -age / FRESHNESS_HALF_LIFE_MS), 0, 1);
}

// ---------------------------------------------------------------- colour

/** Even the stalest tile keeps this much of its hue, so the section stays readable. */
const MIN_HUE_MIX = 0.34;
/** Background luminance at which black text clears the contrast threshold. */
const DARK_TEXT_MIN_LUMINANCE = 0.18;

/**
 * Tiles always fade toward the pane background, so on a dark surface they only
 * get darker and on a light one only lighter. The section hues are picked dark
 * enough for white text; on a light surface each is first lifted until black
 * text clears the threshold, so whichever direction the map fades, one text
 * colour stays readable the whole way down.
 */
export function tileColor(hue: string, storyFreshness: number, palette: TilePalette): string {
  const onDark = relativeLuminance(palette.bg) < 0.5;
  const base = onDark ? hue : liftForDarkText(hue, palette.bg);
  const mix = MIN_HUE_MIX + (1 - MIN_HUE_MIX) * clamp(storyFreshness, 0, 1);
  return mixHex(palette.bg, base, mix);
}

function liftForDarkText(hue: string, background: string): string {
  if (relativeLuminance(hue) >= DARK_TEXT_MIN_LUMINANCE) return hue;
  for (let step = 1; step <= 20; step += 1) {
    const lifted = mixHex(hue, background, step / 20);
    if (relativeLuminance(lifted) >= DARK_TEXT_MIN_LUMINANCE) return lifted;
  }
  return background;
}

export function mixHex(from: string, to: string, ratio: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const r = clamp(ratio, 0, 1);
  return toHex([
    Math.round(a[0] + (b[0] - a[0]) * r),
    Math.round(a[1] + (b[1] - a[1]) * r),
    Math.round(a[2] + (b[2] - a[2]) * r),
  ]);
}

const TILE_TEXT_MIN_CONTRAST = 4.5;

/**
 * The host does this for its own treemap but does not export the helpers, so
 * they are reimplemented here. Tile backgrounds are chosen by the data, not by
 * the theme, so the text colour has to be derived per tile or headlines go
 * unreadable on the mid-tone ones.
 */
/**
 * A board draws up to 120 tiles from about a dozen distinct backgrounds — one
 * per section per freshness step — and each one costs a handful of luminance
 * computations plus a blend search. Memoising by colour turns that from
 * per-tile work into per-shade work.
 */
const textColorCache = new Map<string, string>();
const TEXT_COLOR_CACHE_LIMIT = 512;

export function tileTextColor(backgroundColor: string, palette: TilePalette): string {
  const key = `${backgroundColor}|${palette.bg}|${palette.text}|${palette.textBright}`;
  const hit = textColorCache.get(key);
  if (hit !== undefined) return hit;
  // A theme change makes every key stale at once; dropping the lot is simpler
  // than tracking which, and it refills in one frame.
  if (textColorCache.size >= TEXT_COLOR_CACHE_LIMIT) textColorCache.clear();
  const value = computeTileTextColor(backgroundColor, palette);
  textColorCache.set(key, value);
  return value;
}

function computeTileTextColor(backgroundColor: string, palette: TilePalette): string {
  // One direction for the whole map. Choosing per tile — whichever of black and
  // white happened to win against that tile's background — made the text flip
  // partway down the age ramp, which a reader takes for a second encoding.
  // Tiles only ever fade toward the pane background, and the section hues are
  // chosen so the away-from-background direction always clears the threshold.
  const onDark = relativeLuminance(palette.bg) < 0.5;
  const preferred = onDark ? palette.textBright : palette.text;
  const fallback = onDark ? "#ffffff" : "#000000";
  return blendForContrast(preferred, backgroundColor, fallback, TILE_TEXT_MIN_CONTRAST);
}

export function higherContrast(a: string, b: string, background: string): string {
  return contrastRatio(a, background) >= contrastRatio(b, background) ? a : b;
}

export function blendForContrast(
  preferred: string,
  background: string,
  fallback: string,
  minRatio: number,
): string {
  if (contrastRatio(preferred, background) >= minRatio) return preferred;
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mixHex(preferred, fallback, step / 10);
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }
  return fallback;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "").trim();
  const full = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const int = Number.parseInt(full, 16);
  return Number.isFinite(int)
    ? [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
    : [0, 0, 0];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

/** NaN returns `min`: `Math.max(min, NaN)` is NaN, which then poisons every
 * colour and tile budget downstream as a silently blank board. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------- tile text

/**
 * Width and truncation are injectable because the host measures grapheme
 * clusters and East Asian width, which matters for the CJK editions, while the
 * tests should not need the host to run.
 */
export type Measure = (value: string) => number;
export type Truncate = (value: string, width: number) => string;

const codePoints: Measure = (value) => [...value].length;
const sliceCodePoints: Truncate = (value, width) => [...value].slice(0, Math.max(0, width)).join("");

/**
 * The longest prefix of `value` that fits `width`, measured with the caller's
 * own width function and carrying no truncation marker.
 *
 * This exists because a marker-appending truncator cannot be used to break a
 * line: `truncateToDisplayWidth` returns `width - 3` characters plus "...", so
 * advancing the cursor by its length skips three characters that were never
 * shown. That silently deleted text on every hard break — about a third of a
 * Japanese headline, where each dropped unit is a whole glyph.
 */
export function clipToWidth(value: string, width: number, measure: Measure = codePoints): string {
  if (width <= 0) return "";
  if (measure(value) <= width) return value;
  let kept = "";
  for (const char of value) {
    if (measure(kept + char) > width) break;
    kept += char;
  }
  return kept;
}

/**
 * Break opportunities in one headline. A hyphen is one — "Two-year-old" reads
 * far better split after a hyphen than mid-syllable — and unlike a space it is
 * kept on the line before the break, so `space` says which is which.
 */
interface WrapToken {
  text: string;
  /** Whether a space goes in front of this token when it continues a line. */
  space: boolean;
}

function tokenize(text: string): WrapToken[] {
  return text.split(/\s+/).filter(Boolean).flatMap((word) =>
    word.split(/(?<=-)/).filter(Boolean).map((part, index) => ({ text: part, space: index === 0 })));
}

export function wrapToWidth(
  text: string,
  width: number,
  measure: Measure = codePoints,
): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const token of tokenize(text)) {
    const joiner = current && token.space ? " " : "";
    const candidate = `${current}${joiner}${token.text}`;
    if (measure(candidate) <= width) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    // Still too wide on its own: all a CJK headline, or a very long word, can
    // take is a hard break — on a measured prefix, so nothing is lost.
    let rest = token.text;
    while (measure(rest) > width) {
      const head = clipToWidth(rest, width, measure);
      if (!head) break;
      lines.push(head);
      rest = rest.slice(head.length);
    }
    current = rest;
  }

  if (current) lines.push(current);
  return lines;
}

export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Below this the tile can only hold word fragments, so it is left as bare colour. */
const MIN_TEXT_WIDTH = 6;

/**
 * An outlet clipped below this says nothing — "Re…" is not a source — so the
 * meta line drops to the bare age instead, which is useful on its own.
 */
const MIN_SOURCE_WIDTH = 6;

const ELLIPSIS = "\u2026";

/** Marks a line as cut, so a headline that ran out of rows does not read as one
 * that simply ended there. */
function markCut(line: string, width: number, measure: Measure): string {
  if (width <= 1) return ELLIPSIS;
  const room = width - measure(ELLIPSIS);
  const body = measure(line) <= room ? line : clipToWidth(line, room, measure);
  return `${body.trimEnd()}${ELLIPSIS}`;
}

/**
 * The headline gets every line it can have; the source and age take the last
 * line only when giving it up would not cost the headline a line it was using.
 */
export function tileLines(
  headline: Headline,
  innerWidth: number,
  innerHeight: number,
  now: number,
  measure: Measure = codePoints,
): string[] {
  if (innerWidth < MIN_TEXT_WIDTH || innerHeight < 1) return [];

  const title = wrapToWidth(headline.title, innerWidth, measure);
  if (title.length === 0) return [];

  if (innerHeight < 2) {
    return [title.length > 1 ? markCut(title[0]!, innerWidth, measure) : title[0]!];
  }

  const meta = metaLine(headline, innerWidth, now, measure);
  if (meta && title.length < innerHeight) return [...title, meta];

  if (title.length <= innerHeight) return title;
  // Out of rows: say so rather than leaving a dangling fragment.
  const kept = title.slice(0, innerHeight);
  kept[kept.length - 1] = markCut(kept[kept.length - 1]!, innerWidth, measure);
  return kept;
}

function metaLine(
  headline: Headline,
  innerWidth: number,
  now: number,
  measure: Measure,
): string | null {
  const age = formatAge(now - headline.publishedAt);
  const ageOnly = measure(age) <= innerWidth ? age : null;
  if (!headline.source) return ageOnly;

  const full = `${headline.source} \u00b7 ${age}`;
  if (measure(full) <= innerWidth) return full;

  const room = innerWidth - measure(` \u00b7 ${age}`);
  if (room < MIN_SOURCE_WIDTH) return ageOnly;
  return `${clipToWidth(headline.source, room, measure).trimEnd()} \u00b7 ${age}`;
}

// ---------------------------------------------------------------- budget

/**
 * A headline needs far more room than a ticker symbol, so the map is capped at
 * the number of tiles the pane can actually spell a headline into. Merging six
 * sections yields several hundred stories; drawing them all would leave every
 * tile a wordless smear of colour.
 */
/** Cells of pane per tile, by density. Bigger divisor, fewer and larger tiles. */
const CELLS_PER_TILE: Record<Density, number> = {
  sparse: 200,
  normal: 110,
  dense: 75,
};
const MAX_TILES = 120;
/** Roughly what a tile needs before a headline survives it: a dozen cells
 * across and three rows, plus the gutter each tile gives back. */
const MIN_TILE_CELLS = 13 * 4;

/**
 * The floor is geometry, not a tile count. A fixed minimum forced eight tiles
 * into a 40x12 dock, which is nine cells across each — too narrow to hold a
 * word, so the map became eight columns of shredded fragments. Below that, one
 * legible tile beats eight illegible ones.
 *
 * Density moves how much pane a story gets, but not that floor: "dense" means
 * as many headlines as stay readable, never more than that. Every shipped
 * density already sits above the floor, so it is a guarantee against a future
 * retune rather than something that binds today.
 */
export function tileBudget(width: number, height: number, density: Density = "normal"): number {
  const area = Math.max(0, width) * Math.max(0, height);
  if (!Number.isFinite(area) || area <= 0) return 1;
  const byArea = Math.round(area / (CELLS_PER_TILE[density] ?? CELLS_PER_TILE.normal));
  const ceiling = Math.max(1, Math.floor(area / MIN_TILE_CELLS));
  return clamp(Math.min(byArea, ceiling), 1, MAX_TILES);
}

/**
 * The heaviest stories, in weight order. Weight is relative to each story's
 * own section, so this thins every section at once rather than dropping the
 * sections that happen to sort last.
 */
export function topStories(headlines: readonly Headline[], budget: number): Headline[] {
  // Sorted even when nothing is trimmed: the squarified layout assumes
  // descending weights, and the desktop path drops overflowing tiles by index,
  // so unsorted input both degrades the aspect ratios and truncates arbitrary
  // stories instead of the least important ones.
  const ranked = [...headlines].sort((a, b) => storyWeight(b) - storyWeight(a));
  return ranked.length <= budget ? ranked : ranked.slice(0, Math.max(0, budget));
}

// ------------------------------------------------------------- de-duplication

function dedupeKey(headline: Headline): string {
  return headline.title
    .toLowerCase()
    // Apostrophes are dropped rather than spaced: outlets disagree on straight
    // versus curly, and "Fed's" must key the same as "Feds".
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The same story is carried by several section feeds — a rate rise lands in
 * both Business and National — and would otherwise be drawn twice. The copy
 * that ranked highest wins, so the story keeps its strongest placement and the
 * section it was most prominent in.
 */
export function dedupeHeadlines(headlines: readonly Headline[]): Headline[] {
  const best = new Map<string, Headline>();
  for (const headline of headlines) {
    const key = dedupeKey(headline) || headline.url;
    const incumbent = best.get(key);
    if (!incumbent || storyWeight(headline) > storyWeight(incumbent)) best.set(key, headline);
  }
  return [...best.values()];
}
