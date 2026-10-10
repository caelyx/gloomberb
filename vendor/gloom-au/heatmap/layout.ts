import { buildMetricTreemapNavigationTiles, type MetricTreemapItem } from "gloomberb/components";
import { pct } from "../board/format";
import { fitSectorName } from "./gics";

/**
 * Sector blocks for the heatmap, built from core's flat treemap layout: one
 * squarified layout of the sectors (each weighted by its tiles), then one per
 * sector inside its block under a one-row header. Core's grouped heatmap
 * (`HeatTreemapSurface`) does this with more polish but is not exported to
 * plugins yet.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HeatmapTile<T> extends Rect {
  item: MetricTreemapItem<T>;
}

export interface HeatmapBlock<T> extends Rect {
  /** The sector; null for a flat board, or for unclassified names. */
  group: string | null;
  /** 1 when the block has room for its header row, else 0. */
  header: number;
  items: MetricTreemapItem<T>[];
  /** Tiles in pane cells. */
  tiles: HeatmapTile<T>[];
}

export interface HeatmapLayout<T> {
  blocks: HeatmapBlock<T>[];
  /** Every drawn tile, block by block: the order j and k walk, and what arrow keys search. */
  tiles: HeatmapTile<T>[];
}

export interface HeatmapLayoutOptions {
  grouped: boolean;
  /** Terminal cell height over width. */
  cellAspect: number;
  /** Core's desktop surface lays out fractional tiles; the terminal whole cells. */
  mode: "integer" | "float";
  /** Columns the surface inside a block pads on each side (core's flat surface pads one). */
  inset?: number;
}

const weightOf = (item: MetricTreemapItem<unknown>) => (item.weight != null && item.weight > 0 ? item.weight : 0);

function blockTiles<T>(items: MetricTreemapItem<T>[], block: Rect, header: number, options: HeatmapLayoutOptions): HeatmapTile<T>[] {
  const inset = options.inset ?? 0;
  const width = block.width - inset * 2;
  const height = block.height - header;
  if (width < 1 || height < 1) return [];
  // Core's layout fills in the order given; largest first squarifies best.
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  return buildMetricTreemapNavigationTiles(sorted, width, height, options.cellAspect, options.mode).map((tile) => ({
    item: tile.item,
    x: block.x + inset + tile.x,
    y: block.y + header + tile.y,
    width: tile.width,
    height: tile.height,
  }));
}

export function layoutHeatmap<T>(items: MetricTreemapItem<T>[], width: number, height: number, options: HeatmapLayoutOptions): HeatmapLayout<T> {
  if (width < 1 || height < 1 || items.length === 0) return { blocks: [], tiles: [] };
  if (!options.grouped) {
    const area = { x: 0, y: 0, width, height };
    const tiles = blockTiles(items, area, 0, options);
    return { blocks: [{ ...area, group: null, header: 0, items, tiles }], tiles };
  }
  const groups = new Map<string, MetricTreemapItem<T>[]>();
  for (const item of items) {
    const key = item.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const sectorItems = [...groups.entries()]
    .map(([group, members]) => ({ id: group, label: group, weight: members.reduce((sum, item) => sum + weightOf(item), 0), data: members }))
    .filter((group) => group.weight > 0)
    // Unclassified names go last whatever their size.
    .sort((a, b) => Number(a.id === "") - Number(b.id === "") || b.weight - a.weight);
  const blocks = buildMetricTreemapNavigationTiles(sectorItems, width, height, options.cellAspect, "integer").map((rect): HeatmapBlock<T> => {
    const header = rect.height >= 3 && rect.width >= 4 ? 1 : 0;
    const block = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    return { ...block, group: rect.item.id || null, header, items: rect.item.data, tiles: blockTiles(rect.item.data, block, header, options) };
  });
  return { blocks, tiles: blocks.flatMap((block) => block.tiles) };
}

/**
 * A line that does not fit its tile is dropped, not clipped: "A$311.1" cut
 * from "A$311.13B" reads as a real, wrong number. The layout depends on
 * weights alone, so dropping text keeps the geometry.
 */
export function fitLines(lines: ReadonlyArray<string | null | undefined>, innerWidth: number, rows: number): string[] {
  return lines.filter((line): line is string => !!line && line.length <= innerWidth).slice(0, Math.max(0, rows));
}

/**
 * A block header's text in `width` columns: the sector and its move, then the
 * short name and the move, then the name alone. Names are never cut short:
 * "Consume" could be either consumer sector.
 */
export function headerText(label: string, move: number | null, width: number): { label: string; move: string } {
  const moveText = move == null ? "" : ` ${pct(move)}`;
  const room = width - 1;
  const withMove = moveText ? fitSectorName(label, room - moveText.length) : null;
  if (withMove) return { label: withMove, move: moveText };
  return { label: fitSectorName(label, room) ?? "", move: "" };
}
