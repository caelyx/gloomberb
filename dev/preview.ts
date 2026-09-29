/**
 * Dev-only. Fetches a real Google News edition, runs the plugin's own
 * weighting, colours and tile text through the host's treemap layout, and
 * prints the result as truecolor ANSI — the same pixels the pane draws,
 * without needing the TUI.
 *
 *   bun dev/preview.ts [editionId] [width] [height] [density]
 *   bun dev/preview.ts demo 118 30     — offline fixture, no network
 *   bun dev/preview.ts demo-jp 118 30  — the CJK wrapping case
 */
import { buildMetricTreemapNavigationTiles, type MetricTreemapItem } from "gloomberb/components";
import { displayWidth } from "gloomberb/utils";
import { parseGoogleNewsFeed, feedUrl } from "../parse";
import { assignHues, DEFAULT_SECTIONS, editionById, sectionLabel, type Density, type Headline } from "../types";
import { fixtureHeadlines } from "./fixture";
import { dedupeHeadlines, freshness, storyWeight, tileBudget, tileColor, tileLines, tileTextColor, topStories, type TilePalette } from "../model";

const PALETTE: TilePalette = {
  bg: "#0d1117", text: "#c9d1d9", textBright: "#ffffff",
  selected: "#1f6feb", selectedText: "#ffffff",
};

const editionId = process.argv[2] ?? "US";
const width = Number(process.argv[3] ?? 118);
const height = Number(process.argv[4] ?? 34);
const density = (process.argv[5] ?? "normal") as Density;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const bgAnsi = (hex: string) => `\x1b[48;2;${rgb(hex).join(";")}m`;
const fgAnsi = (hex: string) => `\x1b[38;2;${rgb(hex).join(";")}m`;

const headlines: Headline[] = [];
if (editionId.startsWith("demo")) {
  headlines.push(...fixtureHeadlines(editionId.endsWith("jp")));
} else
for (const section of DEFAULT_SECTIONS) {
  const response = await fetch(feedUrl(section, editionId));
  if (!response.ok) {
    // Google rate-limits with a 503. Saying so beats drawing an empty map and
    // letting the reader assume the layout is broken.
    console.error(`  ${section}: HTTP ${response.status} from Google News — try again in a minute.`);
    continue;
  }
  headlines.push(...parseGoogleNewsFeed(await response.text(), section));
}
if (headlines.length === 0) {
  console.error("\n  No stories fetched; nothing to draw.\n");
  process.exit(1);
}

const now = Date.now();
const hues = assignHues([...DEFAULT_SECTIONS]);
const stories = dedupeHeadlines(headlines);
const board = topStories(stories, tileBudget(width, height, density));
const items: Array<MetricTreemapItem<Headline>> = board.map((headline) => ({
  id: headline.id, label: headline.title, weight: storyWeight(headline), data: headline,
}));

const tiles = buildMetricTreemapNavigationTiles(items, width, height, 2.2, "integer");

// A character grid, composited the way the terminal composites absolute boxes.
const grid: Array<Array<{ ch: string; fg: string; bg: string }>> = Array.from(
  { length: height },
  () => Array.from({ length: width }, () => ({ ch: " ", fg: PALETTE.text, bg: PALETTE.bg })),
);

for (const tile of tiles) {
  const headline = tile.item.data;
  const background = tileColor(hues.get(headline.section)!, freshness(headline.publishedAt, now), PALETTE);
  const textColor = tileTextColor(background, PALETTE);
  const renderWidth = Math.max(1, tile.width - (tile.width > 2 ? 1 : 0));
  const renderHeight = Math.max(1, tile.height - (tile.height > 2 ? 1 : 0));
  const innerWidth = Math.max(1, renderWidth - 1);
  const lines = tileLines(headline, innerWidth, renderHeight, now, displayWidth);

  for (let row = 0; row < renderHeight; row += 1) {
    const y = tile.y + row;
    if (y < 0 || y >= height) continue;
    // Lay out by display width, as the terminal does: an East Asian glyph
    // occupies two cells and the next one starts after both.
    const chars = [...(lines[row] ?? "")];
    let col = 0;
    for (let cell = 0; cell < renderWidth; cell += 1) {
      const x = tile.x + cell;
      if (x < 0 || x >= width) continue;
      grid[y]![x] = { ch: " ", fg: textColor, bg: background };
    }
    for (const char of chars) {
      const cells = displayWidth(char);
      if (col + cells > renderWidth) break;
      const x = tile.x + col;
      if (x >= 0 && x < width) grid[y]![x] = { ch: char, fg: textColor, bg: background };
      // A wide glyph owns the next cell too; leave it blank so nothing overlaps.
      if (cells > 1 && x + 1 < width) grid[y]![x + 1] = { ch: "", fg: textColor, bg: background };
      col += cells;
    }
  }
}

// Mirrors the pane's own legend — numbered toggles and the age key — rather
// than inventing a different one, so this really is what the pane draws.
const drawn: string[] = [];
for (const headline of board) if (!drawn.includes(headline.section)) drawn.push(headline.section);

console.log(
  `\n  ${editionId.startsWith("demo") ? "Fixture" : editionById(editionId).label} · ${headlines.length} fetched · ${stories.length} unique · ${board.length} budgeted (${density}) · ${tiles.length} tiles drawn · ${width}x${height}\n`,
);
const ageKey = [1, 0.55, 0.15]
  .map((level) => `${fgAnsi(tileColor(hues.get(drawn[0]!)!, level, PALETTE))}█\x1b[0m`)
  .join("");
console.log(
  "  " + drawn.map((section, index) =>
    `${fgAnsi(hues.get(section)!)}■\x1b[0m ${index + 1} ${sectionLabel(section)}`).join("  ")
  + `   new ${ageKey} old\n`,
);
for (const row of grid) {
  let line = "";
  for (const cell of row) line += `${bgAnsi(cell.bg)}${fgAnsi(cell.fg)}${cell.ch}`;
  console.log(line + "\x1b[0m");
}
console.log("");
