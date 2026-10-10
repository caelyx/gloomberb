import { buildMetricTreemapNavigationTiles, type MetricTreemapItem } from "gloomberb/components";

/** The host's tile shape, which it does not export. Integer in "integer" mode. */
export interface GroupedTile<T> {
  item: MetricTreemapItem<T>;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutMode = "integer" | "float";

type Section<T> = MetricTreemapItem<Array<MetricTreemapItem<T>>>;

/**
 * How much less square the preferred order's worst block may be than weight
 * order's before the layout gives up on it. Sections of near-equal weight, as
 * the Google feed's are in practice, lay out the same either way; a light
 * topic placed first on the Gloomberb feed becomes a sliver, and that is
 * refused.
 */
const ORDER_ASPECT_TOLERANCE = 1.25;

/**
 * Newsola's arrangement: one block per section, and the stories a treemap
 * inside it. The host's layout only knows flat lists, and fed every story at
 * once it scatters each section across the board by weight alone. Running it
 * twice — sections into the pane, then stories into each section's rectangle —
 * gives the two levels without a layout of our own.
 *
 * Sections are placed in `order` (the legend's order) where that costs the
 * layout nothing, so a block stays put across refreshes and resizes and the
 * legend's numbers run in the order the blocks do. Placing them strictly by
 * weight instead reshuffled the board whenever two sections swapped by a hair.
 *
 * Tiles come back section by section, each in the order its stories were given
 * — so `j`/`k` reads the map block by block.
 *
 * Kept out of `model.ts`, which must not import the host.
 */
export function buildGroupedTiles<T>(
  items: readonly MetricTreemapItem<T>[],
  groupOf: (item: MetricTreemapItem<T>) => string,
  order: readonly string[],
  width: number,
  height: number,
  cellAspect: number,
  mode: LayoutMode,
): Array<GroupedTile<T>> {
  const buckets = new Map<string, Array<MetricTreemapItem<T>>>();
  for (const item of items) {
    const key = groupOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  // A section's area is what its drawn stories weigh, so the block matches
  // the tiles inside it.
  const sections: Array<Section<T>> = [...buckets].map(([key, bucket]) => ({
    id: key,
    label: key,
    weight: bucket.reduce((sum, item) => sum + Math.max(item.weight ?? 0, 0), 0),
    data: bucket,
  }));

  const tiles: Array<GroupedTile<T>> = [];
  for (const rect of placeSections(sections, order, width, height, cellAspect, mode)) {
    // Integer rectangles give integer offsets, so the terminal layout stays on
    // whole cells and its one-cell gutter separates sections like any tiles.
    const inner = buildMetricTreemapNavigationTiles(rect.item.data, rect.width, rect.height, cellAspect, mode);
    for (const tile of inner) {
      tiles.push({ ...tile, x: tile.x + rect.x, y: tile.y + rect.y });
    }
  }
  return tiles;
}

function placeSections<T>(
  sections: Array<Section<T>>,
  order: readonly string[],
  width: number,
  height: number,
  cellAspect: number,
  mode: LayoutMode,
): Array<GroupedTile<Array<MetricTreemapItem<T>>>> {
  // The squarified layout assumes descending weights; this is the baseline.
  const byWeight = [...sections].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const weightLayout = buildMetricTreemapNavigationTiles(byWeight, width, height, cellAspect, mode);

  // Sections the order does not name keep their weight order, after the rest.
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  const preferred = [...byWeight].sort((a, b) => rank(a.id) - rank(b.id));
  if (preferred.every((section, index) => section === byWeight[index])) return weightLayout;

  const orderLayout = buildMetricTreemapNavigationTiles(preferred, width, height, cellAspect, mode);
  // A section the preferred order squeezes off the board entirely is never
  // worth its stability.
  if (orderLayout.length < weightLayout.length) return weightLayout;
  return worstAspect(orderLayout, cellAspect) <= worstAspect(weightLayout, cellAspect) * ORDER_ASPECT_TOLERANCE
    ? orderLayout
    : weightLayout;
}

/** The least square rectangle's long side over its short, measured on screen. */
function worstAspect(rects: ReadonlyArray<{ width: number; height: number }>, cellAspect: number): number {
  let worst = 1;
  for (const rect of rects) {
    const ratio = rect.width / (rect.height * cellAspect);
    if (Number.isFinite(ratio) && ratio > 0) worst = Math.max(worst, ratio, 1 / ratio);
  }
  return worst;
}
