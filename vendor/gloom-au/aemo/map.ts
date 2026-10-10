/**
 * The NEM price map: pricing-condition bands for a spot price, and a low-
 * resolution map of Australia by state. The outlines are hand-drawn in
 * degrees (a few dozen points per coast, state borders on their meridians and
 * parallels), close enough to read as Australia at terminal sizes. The
 * terminal rasterises them into half-block cells; the desktop draws the same
 * outlines as SVG.
 */

/**
 * NEM price limits for 1 July 2026 to 30 June 2027 ($/MWh), from the AEMC.
 *
 * - Market price cap $23,200/MWh and cumulative price threshold $2,225,900/MWh:
 *   AEMC "Schedule of reliability settings, 2026-27 financial year"
 *   (27 February 2026), listed as current at
 *   aemc.gov.au/regulation/electricity-guidelines-and-standards
 *   (PDF: aemc.gov.au/sites/default/files/2026-02/Schedule%20of%20reliability%20settings%20-%202026-27%20financial%20year.pdf).
 *   Both are CPI-indexed each 1 July (2025-26: $20,300 and $1,823,600).
 * - Administered price cap $600/MWh, 1 July 2025 to 30 June 2028: AEMC final
 *   rule of 7 December 2023,
 *   aemc.gov.au/rule-changes/amendment-market-price-cap-cumulative-price-threshold-and-administered-price-cap.
 *   While an administered price period is in force, dispatch prices are capped here.
 * - Market floor price -$1,000/MWh, kept by the 2022 reliability standard and settings review:
 *   aemc.gov.au/market-reviews-advice/2022-reliability-standard-and-settings-review.
 *
 * Do not read these from AEMO's dashboard report NEM_DASHBOARD_MARKET_PRICE_LIMITS:
 * in October 2026 it still returned the 2025-26 cap ($20,300) and threshold.
 * Update the figures each July from the AEMC schedule.
 */
export const MARKET_PRICE_CAP = 23_200;
export const CUMULATIVE_PRICE_THRESHOLD = 2_225_900;
export const ADMINISTERED_PRICE_CAP = 600;
export const MARKET_FLOOR_PRICE = -1_000;

/** A price this close to the market price cap reads as "at the cap". */
const NEAR_CAP_SHARE = 0.9;

export type PriceBand = "negative" | "low" | "normal" | "high" | "veryHigh" | "extreme" | "cap";

export interface PriceBandSpec {
  id: PriceBand;
  label: string;
  /** The range in the legend. */
  range: string;
}

const NEAR_CAP_K = (MARKET_PRICE_CAP * NEAR_CAP_SHARE / 1000).toFixed(1);

/** Cheapest first. Thresholds: below $0, $50, $150, $300, $5,000, 90% of the cap. */
export const PRICE_BANDS: readonly PriceBandSpec[] = [
  { id: "negative", label: "Negative", range: "<$0" },
  { id: "low", label: "Low", range: "$0–50" },
  { id: "normal", label: "Normal", range: "$50–150" },
  { id: "high", label: "High", range: "$150–300" },
  { id: "veryHigh", label: "Very high", range: "$300–5k" },
  { id: "extreme", label: "Extreme", range: `$5k–${NEAR_CAP_K}k` },
  { id: "cap", label: "At cap", range: `$${NEAR_CAP_K}k+` },
];

export function priceBand(price: number): PriceBand {
  if (price < 0) return "negative";
  if (price < 50) return "low";
  if (price < 150) return "normal";
  if (price < 300) return "high";
  if (price < 5_000) return "veryHigh";
  if (price < MARKET_PRICE_CAP * NEAR_CAP_SHARE) return "extreme";
  return "cap";
}

export function priceBandLabel(price: number): string {
  const band = priceBand(price);
  return PRICE_BANDS.find((spec) => spec.id === band)!.label;
}

/** A price in at most six characters, for a label on the map: `$85`, `-$12`, `$1.5k`, `$23.2k`. */
export function compactMwh(price: number): string {
  const sign = price < 0 ? "-" : "";
  const abs = Math.abs(price);
  if (abs < 1_000) return `${sign}$${Math.round(abs)}`;
  const thousands = abs / 1_000;
  return `${sign}$${thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`;
}

// --- Geography -------------------------------------------------------------

export type MapState = "WA" | "NT" | "SA" | "QLD" | "NSW" | "VIC" | "TAS";

/** NEM region id per state; WA and NT are outside the NEM. */
export const STATE_REGION: Record<MapState, string | null> = {
  WA: null,
  NT: null,
  SA: "SA1",
  QLD: "QLD1",
  NSW: "NSW1",
  VIC: "VIC1",
  TAS: "TAS1",
};

export type Point = readonly [lon: number, lat: number];

/** The mainland coast, clockwise from Cape Leveque. */
const MAINLAND: readonly Point[] = [
  [122.9, -16.4], [123.9, -16.3], [124.6, -15.3], [125.6, -14.4], [126.6, -13.9], [127.6, -14.1], [128.2, -14.9],
  [129.0, -14.9], [129.6, -14.0], [130.3, -12.9], [130.8, -12.4], [131.5, -12.2], [132.6, -11.5], [133.4, -11.8],
  [134.6, -12.0], [135.9, -11.9], [136.8, -12.2], [136.5, -13.2], [135.9, -13.7], [135.5, -14.9], [136.6, -15.8],
  [137.7, -16.3], [138.6, -16.8], [139.5, -17.4], [140.6, -17.6], [141.4, -16.2], [141.6, -14.5], [141.6, -12.6],
  [142.5, -10.7], [143.0, -11.6], [143.4, -12.9], [143.6, -14.3], [144.5, -14.3], [145.3, -15.1], [145.5, -16.4],
  [146.1, -17.6], [146.3, -18.9], [147.6, -19.6], [148.8, -20.4], [149.6, -22.2], [150.5, -22.4], [150.9, -23.6],
  [152.2, -24.5], [153.1, -25.3], [153.1, -27.0], [153.6, -28.2], [153.6, -29.0], [153.1, -30.9], [152.7, -31.9],
  [152.0, -32.8], [151.3, -33.8], [150.8, -34.8], [150.2, -35.7], [150.0, -36.6], [149.9, -37.5], [148.6, -37.8],
  [147.5, -38.0], [146.4, -39.1], [145.4, -38.5], [144.9, -38.4], [144.5, -38.2], [143.5, -38.8], [142.3, -38.4],
  [141.0, -38.1], [140.4, -37.9], [139.8, -37.3], [139.6, -36.3], [139.0, -35.7], [138.2, -35.6], [138.5, -34.9],
  [138.1, -34.3], [137.6, -35.0], [137.0, -35.2], [137.5, -34.0], [137.8, -32.7], [137.2, -33.3], [136.2, -34.4],
  [135.6, -34.8], [135.2, -34.4], [134.4, -33.2], [133.6, -32.2], [132.4, -32.0], [131.2, -31.5], [129.0, -31.7],
  [127.3, -32.3], [125.5, -32.6], [124.0, -33.0], [123.6, -33.9], [122.0, -33.9], [120.0, -33.9], [118.9, -34.5],
  [117.9, -35.1], [116.6, -35.0], [115.1, -34.3], [115.0, -33.6], [115.7, -33.3], [115.7, -31.9], [115.0, -30.2],
  [114.9, -29.0], [114.2, -27.7], [113.4, -26.1], [113.8, -25.0], [113.4, -24.0], [113.9, -22.6], [114.4, -21.8],
  [115.4, -21.4], [116.8, -20.6], [118.6, -20.3], [120.0, -19.8], [121.2, -19.4], [122.2, -18.0], [122.3, -17.0],
];

const TASMANIA: readonly Point[] = [
  [144.6, -40.7], [145.6, -40.9], [146.6, -41.1], [147.4, -40.9], [148.3, -40.9], [148.3, -41.9], [148.0, -42.6],
  [147.9, -43.2], [147.0, -43.6], [146.2, -43.5], [145.6, -42.8], [145.2, -42.1], [144.7, -41.3],
];

/** The New South Wales and Victoria border, along the Murray and on to Cape Howe. */
const MURRAY: readonly Point[] = [
  [141.0, -34.0], [142.1, -34.15], [142.8, -34.6], [143.55, -35.3], [144.75, -36.1], [146.0, -36.0], [147.0, -36.15],
  [148.2, -36.8], [149.98, -37.5],
];

/** Mainland bounds plus Tasmania, with a margin of half a degree. */
export const MAP_BOUNDS = { west: 112.9, east: 154.1, north: -10.2, south: -44.1 } as const;
/** Equirectangular around the continent's middle latitude. */
export const LON_SCALE = Math.cos((27 * Math.PI) / 180);

function inside(polygon: readonly Point[], lon: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Latitude of a polyline (west to east) at a longitude, clamped to its ends. */
function lineLat(line: readonly Point[], lon: number): number {
  if (lon <= line[0]![0]) return line[0]![1];
  for (let i = 1; i < line.length; i += 1) {
    const [x1, y1] = line[i - 1]!;
    const [x2, y2] = line[i]!;
    if (lon <= x2) return y1 + ((y2 - y1) * (lon - x1)) / (x2 - x1);
  }
  return line[line.length - 1]![1];
}

/** The Queensland and New South Wales border: the 29th parallel, then the ranges to Point Danger. */
function queenslandBorderLat(lon: number): number {
  return lon <= 151 ? -29 : -29 + (0.8 * (lon - 151)) / 2.55;
}

/** Which state a point is in, or null for the sea. The ACT counts as New South Wales. */
export function stateAt(lon: number, lat: number): MapState | null {
  if (inside(TASMANIA, lon, lat)) return "TAS";
  if (!inside(MAINLAND, lon, lat)) return null;
  if (lon < 129) return "WA";
  if (lon < 138) return lat > -26 ? "NT" : "SA";
  if (lon < 141) return lat > -26 ? "QLD" : "SA";
  if (lat > queenslandBorderLat(lon)) return "QLD";
  return lat > lineLat(MURRAY, lon) ? "NSW" : "VIC";
}

const { west: W, east: E, south: S, north: N } = MAP_BOUNDS;

/**
 * Each state as a polygon in degrees, for drawing as vector shapes: mainland
 * states are regions cut from the bounds along the same borders `stateAt`
 * uses, to be clipped by `MAINLAND_COAST`.
 */
export const STATE_SHAPES: Record<MapState, readonly Point[]> = {
  WA: [[W, N], [129, N], [129, S], [W, S]],
  NT: [[129, N], [138, N], [138, -26], [129, -26]],
  SA: [[129, -26], [141, -26], [141, S], [129, S]],
  QLD: [[138, N], [E, N], [E, queenslandBorderLat(E)], [151, -29], [141, -29], [141, -26], [138, -26]],
  NSW: [[141, -29], [151, -29], [E, queenslandBorderLat(E)], [E, -37.5], ...[...MURRAY].reverse()],
  VIC: [...MURRAY, [E, -37.5], [E, S], [141, S]],
  TAS: TASMANIA,
};
export const MAINLAND_COAST: readonly Point[] = MAINLAND;

/** Map rows for a width in terminal cells, with cells about twice as tall as wide. */
export function mapRowsForWidth(width: number): number {
  const lonSpan = MAP_BOUNDS.east - MAP_BOUNDS.west;
  const latSpan = MAP_BOUNDS.north - MAP_BOUNDS.south;
  return Math.max(1, Math.round((width * latSpan) / (lonSpan * LON_SCALE) / 2));
}

/** Below this the states are too small to label. */
export const MIN_MAP_WIDTH = 28;
export const MAX_MAP_WIDTH = 64;
export const MIN_MAP_ROWS = mapRowsForWidth(MIN_MAP_WIDTH);

/** The largest map that fits, or null when even the smallest does not. */
export function fitMap(width: number, height: number): { width: number; height: number } | null {
  for (let candidate = Math.min(MAX_MAP_WIDTH, Math.floor(width)); candidate >= MIN_MAP_WIDTH; candidate -= 1) {
    const rows = mapRowsForWidth(candidate);
    if (rows <= height) return { width: candidate, height: rows };
  }
  return null;
}

/** Degrees at the centre of a cell column and a half-row. */
function cellLon(column: number, width: number): number {
  return MAP_BOUNDS.west + ((column + 0.5) / width) * (MAP_BOUNDS.east - MAP_BOUNDS.west);
}
function halfRowLat(halfRow: number, height: number): number {
  return MAP_BOUNDS.north - ((halfRow + 0.5) / (height * 2)) * (MAP_BOUNDS.north - MAP_BOUNDS.south);
}
function columnOf(lon: number, width: number): number {
  return Math.round(((lon - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * width - 0.5);
}
function rowOf(lat: number, height: number): number {
  return Math.round(((MAP_BOUNDS.north - lat) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * height - 0.5);
}

/** Label anchors in degrees: the middle of each state, Tasmania's in the sea east of it. */
export const LABEL_ANCHORS: Record<MapState, Point> = {
  WA: [121.5, -25.5],
  NT: [133.5, -19.5],
  SA: [135.6, -29.5],
  QLD: [144.8, -22.5],
  NSW: [146.8, -32.2],
  VIC: [144.2, -37.0],
  TAS: [151.6, -42.0],
};

export interface MapCell {
  /** State in the top and bottom half of the cell. */
  top: MapState | null;
  bottom: MapState | null;
  /** A label character drawn over the cell, and the state it names. */
  label?: { char: string; state: MapState };
}

export type MapLabels = Partial<Record<MapState, readonly string[]>>;

/**
 * The map as rows of cells, each split into a top and bottom half (one `▀`
 * per cell in the terminal), with each state's label lines centred on its
 * anchor and kept inside the grid.
 */
export function composeMap(width: number, height: number, labels: MapLabels = {}): MapCell[][] {
  const rows: MapCell[][] = [];
  for (let row = 0; row < height; row += 1) {
    const cells: MapCell[] = [];
    const topLat = halfRowLat(row * 2, height);
    const bottomLat = halfRowLat(row * 2 + 1, height);
    for (let column = 0; column < width; column += 1) {
      const lon = cellLon(column, width);
      cells.push({ top: stateAt(lon, topLat), bottom: stateAt(lon, bottomLat) });
    }
    rows.push(cells);
  }
  for (const [state, lines] of Object.entries(labels) as Array<[MapState, readonly string[]]>) {
    if (!lines.length) continue;
    const [lon, lat] = LABEL_ANCHORS[state];
    const firstRow = Math.max(0, Math.min(height - lines.length, rowOf(lat, height) - Math.floor((lines.length - 1) / 2)));
    lines.forEach((line, index) => {
      const cells = rows[firstRow + index];
      if (!cells) return;
      const start = Math.max(0, Math.min(width - line.length, columnOf(lon, width) - Math.floor((line.length - 1) / 2)));
      [...line].forEach((char, offset) => {
        const cell = cells[start + offset];
        if (cell) cell.label = { char, state };
      });
    });
  }
  return rows;
}

/**
 * The label lines for a state: its code over its price, or the price alone on
 * a small map. A state outside the NEM has no price: a dash, or its code alone.
 */
export function stateLabel(state: MapState, price: number | null, compact: boolean): string[] {
  if (compact) return [price == null ? state : compactMwh(price)];
  return [state, price == null ? "—" : compactMwh(price)];
}

function luminance(hex: string): number {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!value) return 0.5;
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Whichever of two text colours reads better on a fill. */
export function contrastText(fill: string, first: string, second: string): string {
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  return ratio(fill, first) >= ratio(fill, second) ? first : second;
}
