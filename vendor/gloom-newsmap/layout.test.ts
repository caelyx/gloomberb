import { describe, expect, test } from "bun:test";
import { buildMetricTreemapNavigationTiles, type MetricTreemapItem } from "gloomberb/components";
import { buildGroupedTiles, type GroupedTile, type LayoutMode } from "./layout";

type Story = { section: string };
type Rect = { x: number; y: number; width: number; height: number };

/** `perSection` stories in each section, weighted as a feed decays. */
function board(perSection: Record<string, number>, scale: Record<string, number> = {}): Array<MetricTreemapItem<Story>> {
  const items: Array<MetricTreemapItem<Story>> = [];
  for (const [section, count] of Object.entries(perSection)) {
    for (let rank = 0; rank < count; rank += 1) {
      items.push({
        id: `${section}-${rank}`,
        label: `${section} ${rank}`,
        weight: (scale[section] ?? 1) / Math.pow(rank + 2, 0.78),
        data: { section },
      });
    }
  }
  // The pane hands the layout its board heaviest first.
  return items.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}

const sectionOf = (item: MetricTreemapItem<Story>) => item.data.section;
const MODES: LayoutMode[] = ["integer", "float"];
const EPSILON = 1e-6;
const FOUR = { WORLD: 8, NATION: 7, BUSINESS: 7, TECHNOLOGY: 6 };
const FOUR_ORDER = Object.keys(FOUR);

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width - EPSILON && b.x < a.x + a.width - EPSILON
    && a.y < b.y + b.height - EPSILON && b.y < a.y + a.height - EPSILON;
}

function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x, y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}

function bySection(tiles: Array<GroupedTile<Story>>): Map<string, Array<GroupedTile<Story>>> {
  const groups = new Map<string, Array<GroupedTile<Story>>>();
  for (const tile of tiles) {
    const own = groups.get(tile.item.data.section);
    if (own) own.push(tile);
    else groups.set(tile.item.data.section, [tile]);
  }
  return groups;
}

/** Sections in the order their tiles come back, which is the order they were placed. */
function placement(tiles: Array<GroupedTile<Story>>): string[] {
  return [...bySection(tiles).keys()];
}

describe.each(MODES)("buildGroupedTiles (%s)", (mode) => {
  test("each section is one block that no other section's tile enters", () => {
    const tiles = buildGroupedTiles(board(FOUR), sectionOf, FOUR_ORDER, 118, 30, 2.2, mode);
    const groups = bySection(tiles);
    expect([...groups.keys()].sort()).toEqual([...FOUR_ORDER].sort());

    for (const [section, own] of groups) {
      const block = boundsOf(own);
      const intruders = tiles.filter((tile) => tile.item.data.section !== section && overlaps(tile, block));
      expect(intruders.map((tile) => tile.item.id)).toEqual([]);
    }
  });

  test("tiles stay inside the pane and never overlap", () => {
    const tiles = buildGroupedTiles(board(FOUR), sectionOf, FOUR_ORDER, 118, 30, 2.2, mode);
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(-EPSILON);
      expect(tile.y).toBeGreaterThanOrEqual(-EPSILON);
      expect(tile.x + tile.width).toBeLessThanOrEqual(118 + EPSILON);
      expect(tile.y + tile.height).toBeLessThanOrEqual(30 + EPSILON);
    }
    for (const [index, a] of tiles.entries()) {
      for (const b of tiles.slice(index + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });

  test("a single section lays out exactly as the flat treemap does", () => {
    const items = board({ WORLD: 20 });
    expect(buildGroupedTiles(items, sectionOf, ["WORLD"], 88, 16, 2.2, mode))
      .toEqual(buildMetricTreemapNavigationTiles(items, 88, 16, 2.2, mode));
  });

  test("tiles come section by section, heaviest story first within each", () => {
    const tiles = buildGroupedTiles(board(FOUR), sectionOf, FOUR_ORDER, 118, 30, 2.2, mode);
    const order = tiles.map((tile) => tile.item.data.section);
    // Contiguous runs: a section, once left, never comes back.
    const runs = order.filter((section, index) => section !== order[index - 1]);
    expect(new Set(runs).size).toBe(runs.length);

    for (const own of bySection(tiles).values()) {
      const weights = own.map((tile) => tile.item.weight ?? 0);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
    }
  });

  test("a section's area follows its summed weight", () => {
    const tiles = buildGroupedTiles(
      board({ WORLD: 6, BUSINESS: 6 }, { WORLD: 2, BUSINESS: 1 }), sectionOf, ["WORLD", "BUSINESS"], 120, 40, 2.2, mode,
    );
    const area = (section: string) => bySection(tiles).get(section)!
      .reduce((sum, tile) => sum + tile.width * tile.height, 0);
    expect(area("WORLD") / area("BUSINESS")).toBeCloseTo(2, 0);
  });

  test("near-equal sections keep the given order, whichever happens to weigh more", () => {
    // Weights a hair apart, in both directions: by weight alone the two boards
    // place their sections differently, which on a live feed is every refresh.
    const lighter = { WORLD: 0.97, NATION: 1, BUSINESS: 1.02, TECHNOLOGY: 0.99 };
    const heavier = { WORLD: 1.03, NATION: 0.98, BUSINESS: 1, TECHNOLOGY: 1.01 };
    for (const scale of [lighter, heavier]) {
      const tiles = buildGroupedTiles(board(FOUR, scale), sectionOf, FOUR_ORDER, 118, 30, 2.2, mode);
      expect(placement(tiles)).toEqual(FOUR_ORDER);
    }
  });

  test("the given order is dropped when it would squeeze a section into a sliver", () => {
    // A light topic first: in order, it takes a full-height column six cells
    // wide; by weight, it is a wider band along the bottom.
    const uneven = { LIGHT: 2, HEAVY: 12, MIDDLE: 6 };
    const tiles = buildGroupedTiles(
      board(uneven, { LIGHT: 0.3 }), sectionOf, ["LIGHT", "HEAVY", "MIDDLE"], 118, 30, 2.2, mode,
    );
    expect(placement(tiles)).toEqual(["HEAVY", "MIDDLE", "LIGHT"]);
  });

  test("sections the order does not name are placed after the ones it does", () => {
    const tiles = buildGroupedTiles(board(FOUR), sectionOf, ["TECHNOLOGY", "WORLD"], 118, 30, 2.2, mode);
    expect(placement(tiles).slice(0, 2)).toEqual(["TECHNOLOGY", "WORLD"]);
  });

  test("a full board draws as many tiles as the flat layout does", () => {
    // The budget's ceiling: 120 stories over six sections, on a large pane.
    const sizes = { WORLD: 24, NATION: 22, BUSINESS: 20, TECHNOLOGY: 20, SPORTS: 18, TOP: 16 };
    const items = board(sizes);
    const flat = buildMetricTreemapNavigationTiles(items, 240, 70, 2.2, mode);
    const grouped = buildGroupedTiles(items, sectionOf, Object.keys(sizes), 240, 70, 2.2, mode);
    expect(grouped.length).toBe(flat.length);
  });
});

test("integer mode keeps every tile on whole cells", () => {
  const tiles = buildGroupedTiles(board(FOUR), sectionOf, FOUR_ORDER, 117, 29, 2.2, "integer");
  for (const tile of tiles) {
    expect([tile.x, tile.y, tile.width, tile.height].every(Number.isInteger)).toBe(true);
  }
});

test("nothing to lay out draws nothing", () => {
  expect(buildGroupedTiles([], sectionOf, FOUR_ORDER, 80, 20, 2.2, "integer")).toEqual([]);
});
