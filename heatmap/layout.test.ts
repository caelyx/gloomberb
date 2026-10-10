import { describe, expect, test } from "bun:test";
import type { MetricTreemapItem } from "gloomberb/components";
import { fitLines, headerText, layoutHeatmap, type Rect } from "./layout";

const item = (id: string, group: string | null, weight: number): MetricTreemapItem<null> => ({ id, label: id, weight, group, data: null });

const items = [
  item("BHP", "Materials", 17), item("RIO", "Materials", 8), item("FMG", "Materials", 7),
  item("CBA", "Financials", 16), item("NAB", "Financials", 11), item("WBC", "Financials", 11),
  item("CSL", "Health Care", 9), item("TLS", "Communication Services", 7), item("NEW", null, 9),
];

const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width + 1e-9 && inner.y + inner.height <= outer.y + outer.height + 1e-9;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("layoutHeatmap", () => {
  const options = { grouped: true, cellAspect: 2, mode: "integer" as const };

  test("sector blocks fill the area without overlapping, largest first, unclassified last", () => {
    const { blocks } = layoutHeatmap(items, 100, 30, options);
    expect(blocks.map((block) => block.group)).toEqual(["Financials", "Materials", "Health Care", "Communication Services", null]);
    expect(blocks.reduce((sum, block) => sum + block.width * block.height, 0)).toBe(100 * 30);
    for (const [index, block] of blocks.entries()) {
      for (const other of blocks.slice(index + 1)) expect(overlap(block, other)).toBe(false);
    }
  });

  test("each tile sits in its own block, below the header row", () => {
    const { blocks, tiles } = layoutHeatmap(items, 100, 30, options);
    expect(tiles).toHaveLength(items.length);
    for (const block of blocks) {
      expect(block.header).toBe(1);
      for (const tile of block.tiles) {
        expect(tile.item.group ?? null).toBe(block.group);
        expect(inside(tile, { ...block, y: block.y + 1, height: block.height - 1 })).toBe(true);
      }
    }
  });

  test("an inset leaves the surface's padding free; a flat board is one block without a header", () => {
    const padded = layoutHeatmap(items, 100, 30, { ...options, mode: "float", inset: 1 });
    for (const block of padded.blocks) for (const tile of block.tiles) expect(tile.x).toBeGreaterThanOrEqual(block.x + 1);
    const flat = layoutHeatmap(items, 100, 30, { ...options, grouped: false });
    expect(flat.blocks).toHaveLength(1);
    expect(flat.blocks[0]).toMatchObject({ group: null, header: 0, x: 0, y: 0, width: 100, height: 30 });
    expect(flat.tiles).toHaveLength(items.length);
  });
});

test("tiles are laid out largest first whatever order they come in", () => {
  const { tiles } = layoutHeatmap([item("S", null, 10), item("L", null, 50)], 40, 10, { grouped: false, cellAspect: 2, mode: "integer" });
  expect(tiles.map((tile) => tile.item.id)).toEqual(["L", "S"]);
  expect(tiles[0]!.width * tiles[0]!.height).toBeGreaterThan(tiles[1]!.width * tiles[1]!.height);
});

describe("fitLines", () => {
  test("drops a line wider than the tile instead of clipping it, and stops at the tile's rows", () => {
    expect(fitLines(["+1.23%", "A$311.13B", null, "Materials"], 7, 3)).toEqual(["+1.23%"]);
    expect(fitLines(["+1.23%", "A$9B", "Banks"], 8, 2)).toEqual(["+1.23%", "A$9B"]);
  });
});

describe("headerText", () => {
  test("the full name and move, then the short name and move, then the name alone; never a cut name", () => {
    expect(headerText("Consumer Discretionary", 1.8, 40)).toEqual({ label: "Consumer Discretionary", move: " +1.80%" });
    expect(headerText("Consumer Discretionary", 1.8, 18)).toEqual({ label: "Cons Disc", move: " +1.80%" });
    expect(headerText("Consumer Staples", -0.4, 14)).toEqual({ label: "Cons Staples", move: "" });
    expect(headerText("Utilities", 0.2, 6)).toEqual({ label: "", move: "" });
    expect(headerText("Financials", -0.001, 30)).toEqual({ label: "Financials", move: " 0.00%" });
  });
});
