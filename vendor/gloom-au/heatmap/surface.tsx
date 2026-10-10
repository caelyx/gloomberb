import { Fragment } from "react";
import { MetricTreemapSurface, type MetricTreemapItem } from "gloomberb/components";
import { blendHex, colors, priceColor } from "gloomberb/theme";
import { Box, Text, TextAttributes, useUiCapabilities } from "gloomberb/ui";
import { fitSectorName, shortSectorName } from "./gics";
import { fitLines, headerText, type HeatmapBlock, type HeatmapLayout, type HeatmapTile } from "./layout";

/** A move this large or more is drawn at full strength, as on core's heatmap. */
const FULL_SCALE_PERCENT = 3;

/**
 * The terminal tile colour for a day's move: the page blended toward the
 * theme's up or down colour by the size of the move, so a 0.2% day reads
 * paler than a 3% one. A missing move is grey, never the flat colour, and a
 * move that rounds to 0.00% is flat. Core's heat scale is not exported to
 * plugins, and on the desktop core's flat treemap surface colours the tiles
 * with its own scale (see docs/heatmap.md).
 */
export function heatColor(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(change)) return blendHex(colors.bg, colors.textDim, 0.3);
  if (Math.abs(change) < 0.005) return blendHex(colors.bg, colors.neutral, 0.45);
  const strength = Math.min(1, Math.abs(change) / FULL_SCALE_PERCENT);
  return blendHex(colors.bg, change > 0 ? colors.positive : colors.negative, 0.3 + 0.7 * strength);
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(value)) return 0;
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
}

/** Dark text on a light tile, light text on a dark one. */
function textOn(background: string): string {
  const bright = luminance(colors.textBright) > luminance(colors.bg) ? colors.textBright : colors.bg;
  const dark = bright === colors.textBright ? colors.bg : colors.textBright;
  return luminance(background) > 0.55 ? dark : bright;
}

export interface BlockHeader {
  label: string;
  move: number | null;
}

export interface HeatmapSurfaceProps<T> {
  layout: HeatmapLayout<T>;
  width: number;
  height: number;
  selectedId: string | null;
  describeBlock: (block: HeatmapBlock<T>) => BlockHeader;
  onSelect: (item: MetricTreemapItem<T>) => void;
  onActivate: (item: MetricTreemapItem<T>) => void;
}

function Header<T>({ block, header }: { block: HeatmapBlock<T>; header: BlockHeader }) {
  const text = headerText(header.label, header.move, block.width);
  return (
    <Box position="absolute" left={block.x} top={block.y} width={block.width} height={1} flexDirection="row">
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{text.label}</Text>
      {text.move && <Text fg={priceColor(header.move!)}>{text.move}</Text>}
    </Box>
  );
}

function Tile<T>({ tile, selected, onSelect, onActivate }: { tile: HeatmapTile<T>; selected: boolean; onSelect: () => void; onActivate: () => void }) {
  // A one-cell gutter to the right and below keeps neighbouring tiles apart.
  const width = Math.max(1, tile.width - (tile.width > 2 ? 1 : 0));
  const height = Math.max(1, tile.height - (tile.height > 2 ? 1 : 0));
  const inner = Math.max(1, width - 1);
  // The selected tile keeps its move's hue, lifted toward the bright text colour.
  const heat = heatColor(tile.item.colorValue);
  const background = selected ? blendHex(heat, colors.textBright, 0.3) : heat;
  const fg = textOn(background);
  // A sector name too long for the tile takes its short form; only a tile too narrow even for that cuts it.
  const label = fitSectorName(tile.item.label, inner) ?? shortSectorName(tile.item.label).slice(0, inner);
  const tertiary = tile.item.tertiaryText ? fitSectorName(tile.item.tertiaryText, inner) : null;
  const lines = [label, ...fitLines([tile.item.primaryText, tile.item.secondaryText, tertiary], inner, height - 1)];
  return (
    <Box
      position="absolute"
      left={tile.x}
      top={tile.y}
      width={width}
      height={height}
      backgroundColor={background}
      onMouseDown={(event: { preventDefault(): void }) => {
        event.preventDefault();
        onSelect();
      }}
      onDoubleClick={onActivate}
    >
      {lines.map((line, index) => (
        <Text key={index} fg={fg} attributes={index === 0 || selected ? TextAttributes.BOLD : TextAttributes.NONE}>{line}</Text>
      ))}
    </Box>
  );
}

/**
 * Sector blocks, each under a header naming the sector and its cap-weighted
 * move. The terminal draws the tiles itself so they can carry graded heat
 * colours; the desktop draws each block with core's flat surface, which takes
 * no colour from the plugin and grades on its own scale.
 */
export function HeatmapSurface<T>({ layout, width, height, selectedId, describeBlock, onSelect, onActivate }: HeatmapSurfaceProps<T>) {
  const { nativePaneChrome } = useUiCapabilities();
  return (
    <Box width={width} height={height} paddingX={1} backgroundColor={colors.bg}>
      <Box position="relative" width={Math.max(1, width - 2)} height={height}>
        {layout.blocks.map((block) => (
          <Fragment key={`block:${block.group ?? ""}`}>
            {block.header > 0 && <Header block={block} header={describeBlock(block)} />}
            {nativePaneChrome
              ? (
                <Box position="absolute" left={block.x} top={block.y + block.header} width={block.width} height={block.height - block.header}>
                  <MetricTreemapSurface
                    items={block.items}
                    width={block.width}
                    height={block.height - block.header}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onActivate={onActivate}
                  />
                </Box>
              )
              : block.tiles.map((tile) => (
                <Tile
                  key={tile.item.id}
                  tile={tile}
                  selected={tile.item.id === selectedId}
                  onSelect={() => onSelect(tile.item)}
                  onActivate={() => onActivate(tile.item)}
                />
              ))}
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}
