import { createElement, useId, useMemo, type ReactNode } from "react";
import { blendHex, colors } from "gloomberb/theme";
import { Box, Span, Text, TextAttributes, useUiCapabilities } from "gloomberb/ui";
import {
  composeMap,
  contrastText,
  fitMap,
  LABEL_ANCHORS,
  LON_SCALE,
  MAINLAND_COAST,
  MAP_BOUNDS,
  mapRowsForWidth,
  MAX_MAP_WIDTH,
  MIN_MAP_WIDTH,
  PRICE_BANDS,
  priceBand,
  STATE_REGION,
  STATE_SHAPES,
  stateLabel,
  type MapCell,
  type MapState,
  type Point,
  type PriceBand,
} from "./map";
import type { RegionNow } from "./model";

const STATES = Object.keys(STATE_REGION) as MapState[];
/** Swatch, gap, the longest band name and its range. */
const LEGEND_WIDTH = 22;
const LEGEND_LABEL_WIDTH = 9;
/** Two-line labels (code over price) from this map width; below it the price alone. */
const FULL_LABEL_WIDTH = 40;

export function bandColor(band: PriceBand): string {
  switch (band) {
    case "negative": return colors.positive;
    case "low": return blendHex(colors.positive, colors.neutral, 0.55);
    case "normal": return colors.neutral;
    case "high": return colors.warning;
    case "veryHigh": return blendHex(colors.warning, colors.negative, 0.55);
    case "extreme": return colors.negative;
    case "cap": return blendHex(colors.negative, colors.bg, 0.45);
  }
}

/** WA and NT: the land, without a price. */
function outsideColor(): string {
  return blendHex(colors.bg, colors.textDim, 0.4);
}

/**
 * Half-block cells have no room for a border, so neighbouring states in the
 * same band would merge: each takes one of three shades of its band colour,
 * no two neighbours alike (WA, NT, SA, QLD, NSW and VIC need three).
 */
const TERMINAL_SHADE: Record<MapState, number> = { SA: 0, TAS: 0, NSW: 1, NT: 1, QLD: 2, VIC: 2, WA: 2 };

type StatePrices = Partial<Record<MapState, number>>;

function statePrices(regions: readonly RegionNow[]): StatePrices {
  const prices: StatePrices = {};
  for (const state of STATES) {
    const region = regions.find((entry) => entry.region === STATE_REGION[state]);
    if (region) prices[state] = region.price;
  }
  return prices;
}

function stateFill(state: MapState, prices: StatePrices): string {
  const price = prices[state];
  return price == null ? outsideColor() : bandColor(priceBand(price));
}

function terminalFill(state: MapState, prices: StatePrices): string {
  const shade = TERMINAL_SHADE[state];
  return shade ? blendHex(stateFill(state, prices), colors.bg, 0.14 * shade) : stateFill(state, prices);
}

/** Rows the band wants at a pane width: the widest map that fits beside its legend. */
export function priceMapRows(width: number): number {
  const mapWidth = Math.min(MAX_MAP_WIDTH, width - 2 - (width - 2 >= MIN_MAP_WIDTH + LEGEND_WIDTH ? LEGEND_WIDTH : 0));
  return mapWidth >= MIN_MAP_WIDTH ? mapRowsForWidth(mapWidth) : 0;
}

interface PriceMapProps {
  regions: readonly RegionNow[];
  width: number;
  height: number;
}

/** Each NEM state coloured by its spot price band, with its price; WA and NT dim. */
export function NemPriceMap(props: PriceMapProps) {
  return useUiCapabilities().nativePaneChrome ? <DesktopPriceMap {...props} /> : <TerminalPriceMap {...props} />;
}

function Legend({ prices }: { prices: StatePrices }) {
  const shown = new Set(Object.values(prices).map((price) => priceBand(price)));
  const entries = [
    ...PRICE_BANDS.map((band) => ({ id: band.id, label: band.label, range: band.range, color: bandColor(band.id), active: shown.has(band.id) })),
    { id: "outside", label: "Outside NEM", range: "", color: outsideColor(), active: false },
  ];
  return (
    <Box flexDirection="column" width={LEGEND_WIDTH} flexShrink={0}>
      {entries.map((entry) => (
        <Box key={entry.id} flexDirection="row" height={1} gap={1}>
          <Box width={2} height={1} flexShrink={0} backgroundColor={entry.color} />
          <Text fg={entry.active ? colors.textBright : colors.textDim} attributes={entry.active ? TextAttributes.BOLD : 0}>{entry.label.padEnd(LEGEND_LABEL_WIDTH)}</Text>
          {entry.range ? <Text fg={colors.textMuted}>{entry.range}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

interface Run {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
}

function cellRun(cell: MapCell, prices: StatePrices): Run {
  if (cell.label) {
    const { char, state } = cell.label;
    const fill = terminalFill(state, prices);
    // On its own state the label sits on the fill; over the sea or a neighbour, it takes the state's colour.
    if (cell.top === state && cell.bottom === state) {
      return { text: char, bg: fill, fg: contrastText(fill, colors.bg, colors.textBright), bold: true };
    }
    return { text: char, fg: prices[state] == null ? colors.textDim : fill, bold: true };
  }
  const { top, bottom } = cell;
  if (!top && !bottom) return { text: " " };
  if (top === bottom) return { text: "█", fg: terminalFill(top!, prices) };
  if (top && bottom) return { text: "▀", fg: terminalFill(top, prices), bg: terminalFill(bottom, prices) };
  return top ? { text: "▀", fg: terminalFill(top, prices) } : { text: "▄", fg: terminalFill(bottom!, prices) };
}

function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.fg === run.fg && last.bg === run.bg && last.bold === run.bold) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

function layoutFor(width: number, height: number): { map: { width: number; height: number }; legend: boolean } | null {
  const inner = width - 2;
  const besideLegend = fitMap(inner - LEGEND_WIDTH - 1, height);
  if (besideLegend && height >= PRICE_BANDS.length + 1) return { map: besideLegend, legend: true };
  const alone = fitMap(inner, height);
  return alone ? { map: alone, legend: false } : null;
}

function TerminalPriceMap({ regions, width, height }: PriceMapProps) {
  const prices = useMemo(() => statePrices(regions), [regions]);
  const layout = layoutFor(width, height);
  const rows = useMemo(() => {
    if (!layout) return [];
    const compact = layout.map.width < FULL_LABEL_WIDTH;
    const labels = Object.fromEntries(STATES.map((state) => [state, stateLabel(state, prices[state] ?? null, compact)]));
    return composeMap(layout.map.width, layout.map.height, labels).map((cells) => mergeRuns(cells.map((cell) => cellRun(cell, prices))));
  }, [layout?.map.width, layout?.map.height, prices]);
  if (!layout) return null;
  return (
    <Box flexDirection="row" width={width} height={height} paddingX={1} gap={1} overflow="hidden">
      <Box flexDirection="column" width={layout.map.width} flexShrink={0}>
        {rows.map((runs, index) => (
          <Text key={index}>
            {runs.map((run, runIndex) => (
              <Span key={runIndex} fg={run.fg} bg={run.bg} attributes={run.bold ? TextAttributes.BOLD : 0}>{run.text}</Span>
            ))}
          </Text>
        ))}
      </Box>
      {layout.legend ? <Legend prices={prices} /> : null}
    </Box>
  );
}

// --- Desktop and web: the same outlines as SVG -------------------------------

const VIEW_WIDTH = (MAP_BOUNDS.east - MAP_BOUNDS.west) * LON_SCALE;
const VIEW_HEIGHT = MAP_BOUNDS.north - MAP_BOUNDS.south;

function project([lon, lat]: Point): [number, number] {
  return [(lon - MAP_BOUNDS.west) * LON_SCALE, MAP_BOUNDS.north - lat];
}

function polygonPoints(points: readonly Point[]): string {
  return points.map((point) => project(point).map((value) => value.toFixed(3)).join(",")).join(" ");
}

function DesktopPriceMap({ regions, width, height }: PriceMapProps) {
  const prices = useMemo(() => statePrices(regions), [regions]);
  const clipId = `nem-coast-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const stroke = colors.bg;
  const shapes: ReactNode[] = [];
  for (const state of STATES) {
    const fill = stateFill(state, prices);
    const points = STATE_SHAPES[state];
    shapes.push(createElement("polygon", {
      key: `shape-${state}`,
      points: polygonPoints(points),
      fill,
      stroke,
      strokeWidth: 1,
      vectorEffect: "non-scaling-stroke",
      clipPath: state === "TAS" ? undefined : `url(#${clipId})`,
    }));
  }
  const labels = STATES.map((state) => {
    const [x, y] = project(LABEL_ANCHORS[state]);
    const price = prices[state] ?? null;
    const fill = stateFill(state, prices);
    // Tasmania's label sits in the sea beside it.
    const onLand = state !== "TAS";
    const textFill = onLand ? contrastText(fill, colors.bg, colors.textBright) : price == null ? colors.textDim : fill;
    const [code, value] = stateLabel(state, price, false);
    return createElement(
      "text",
      { key: `label-${state}`, x, y, textAnchor: "middle", fill: textFill, fontSize: 1.5, fontWeight: 600 },
      createElement("tspan", { x, dy: "-0.2em" }, code),
      createElement("tspan", { x, dy: "1.15em" }, value),
    );
  });
  const svg = createElement(
    "svg",
    {
      viewBox: `0 0 ${VIEW_WIDTH.toFixed(3)} ${VIEW_HEIGHT.toFixed(3)}`,
      preserveAspectRatio: "xMidYMid meet",
      width: "100%",
      height: "100%",
      role: "img",
      "aria-label": "NEM spot prices by state",
      style: { display: "block", fontFamily: "inherit" },
    },
    createElement("defs", null, createElement("clipPath", { id: clipId }, createElement("polygon", { points: polygonPoints(MAINLAND_COAST) }))),
    ...shapes,
    ...labels,
  );
  const legend = width - 2 >= MIN_MAP_WIDTH + LEGEND_WIDTH && height >= PRICE_BANDS.length + 1;
  return (
    <Box flexDirection="row" width={width} height={height} paddingX={1} gap={1} overflow="hidden">
      <Box flexGrow={1} flexBasis={0} height={height} overflow="hidden">{svg}</Box>
      {legend ? <Legend prices={prices} /> : null}
    </Box>
  );
}
