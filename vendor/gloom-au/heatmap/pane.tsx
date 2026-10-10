import { useCallback, useEffect, useMemo, useState } from "react";
import {
  findMetricTreemapNeighbor,
  loadingText,
  PaneStatusBody,
  QueryBar,
  unavailableText,
  usePaneFooter,
  usePaneNoticeFooter,
  type MetricTreemapDirection,
  type MetricTreemapItem,
} from "gloomberb/components";
import { useAssetData, useAsyncResource, useAutoRefresh, usePaneSettingValue, usePluginTickerActions, useShortcut, useUpdatedAgo } from "gloomberb/react";
import { priceColor } from "gloomberb/theme";
import { TICKER_RESEARCH_PANE_ID } from "gloomberb/types/config";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, useUiCapabilities } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { capLabel, level, pct } from "../board/format";
import { loadHeatmap, type HeatmapBoard } from "./client";
import { layoutHeatmap, type HeatmapBlock } from "./layout";
import {
  canGroupBySector,
  capWeightedMove,
  DEFAULT_SOURCE,
  DEFAULT_UNIVERSE,
  HEATMAP_UNIVERSES,
  tileWeight,
  toSource,
  toUniverse,
  universeLabel,
  type HeatmapAsset,
  type HeatmapUniverse,
} from "./model";
import { HeatmapSurface } from "./surface";

export const HEATMAP_PANE_ID = "au-heatmap";
export const GROUP_SETTING = "groupBySector";

/** The footer's word for a board that fell back from the index scan to a ranking. */
export function fallbackNotice(board: Pick<HeatmapBoard, "universe" | "fallback">): string | null {
  if (!board.fallback) return null;
  const what = board.universe === "sectors" ? "Sector weights by market cap" : `Top ${board.universe === "asx50" ? 50 : 200} by market cap`;
  return `${what} (TradingView unavailable)`;
}

function buildItems(assets: readonly HeatmapAsset[], universe: HeatmapUniverse, grouped: boolean): Array<MetricTreemapItem<HeatmapAsset>> {
  return assets.map((asset) => ({
    id: asset.symbol,
    label: asset.label,
    // Sector indices without known weights share the board evenly.
    weight: tileWeight(asset.size) || (universe === "sectors" ? 1 : 0),
    colorValue: asset.changePercent,
    primaryText: pct(asset.changePercent),
    secondaryText: universe === "sectors" ? level(asset.price) : capLabel(asset.size),
    // Under a sector header the tile names its industry group instead.
    tertiaryText: universe === "sectors" ? null : grouped ? asset.industryGroup : asset.sector,
    group: grouped ? asset.sector : null,
    data: asset,
  }));
}

/** HMA: the ASX 50, ASX 200 or the sector indices, sized by market cap and coloured by the day's move. */
export function HeatmapPane({ focused, width, height }: PaneProps) {
  const assetData = useAssetData();
  const { pinTicker } = usePluginTickerActions();
  const { cellWidthPx = 8, cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  // Pane settings rather than private state, so the settings dialog shows them.
  const [universeSetting, setUniverse] = usePaneSettingValue<string>("universe", DEFAULT_UNIVERSE);
  const [sourceSetting] = usePaneSettingValue<string>("source", DEFAULT_SOURCE);
  const [groupSetting, setGroupSetting] = usePaneSettingValue<boolean>(GROUP_SETTING, true);
  const universe = toUniverse(universeSetting);
  const source = toSource(sourceSetting);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loader = useCallback((force: boolean) => {
    if (!assetData) return Promise.reject(new Error("Market data is unavailable"));
    return loadHeatmap(assetData, { universe, source, force });
  }, [assetData, source, universe]);
  const { data, loading, error, updatedAt, load, reload } = useAsyncResource(loader);
  // The timer takes the minute-long board cache; `r` asks for fresh quotes.
  const autoRefresh = useCallback(() => { void load(false); }, [load]);
  useAutoRefresh(updatedAt, autoRefresh);
  // A board kept from an earlier load says when it was built, not when the failed refresh answered.
  const updated = useUpdatedAgo(data?.builtAt ?? updatedAt);

  const assets = useMemo(() => data?.assets ?? [], [data]);
  const grouped = universe !== "sectors" && groupSetting !== false && canGroupBySector(assets);
  const bodyHeight = Math.max(1, height - 1);
  const cellAspect = Math.max(0.5, Math.min(4, cellHeightPx / Math.max(1, cellWidthPx)));
  const layout = useMemo(() => {
    const options = { cellAspect, mode: nativePaneChrome ? "float" as const : "integer" as const, inset: nativePaneChrome ? 1 : 0 };
    const area = Math.max(1, width - 2);
    if (grouped) {
      const blocks = layoutHeatmap(buildItems(assets, universe, true), area, bodyHeight, { ...options, grouped: true });
      // Sector blocks too small for any header would hide the sectors; a flat map names them on the tiles.
      if (blocks.blocks.some((block) => block.header > 0)) return blocks;
    }
    return layoutHeatmap(buildItems(assets, universe, false), area, bodyHeight, { ...options, grouped: false });
  }, [assets, bodyHeight, cellAspect, grouped, nativePaneChrome, universe, width]);
  const tiles = layout.tiles;
  const activeIndex = Math.max(0, tiles.findIndex((tile) => tile.item.id === selectedId));
  const selected = tiles[activeIndex]?.item.data ?? null;

  // Only drawn tiles are selectable; a name too small to draw hands the selection to the first tile.
  useEffect(() => {
    if (selectedId && tiles.some((tile) => tile.item.id === selectedId)) return;
    const first = tiles[0]?.item.id ?? null;
    if (first !== selectedId) setSelectedId(first);
  }, [selectedId, tiles]);

  const describeBlock = useCallback((block: HeatmapBlock<HeatmapAsset>) => ({
    label: block.group ?? "Unclassified",
    move: capWeightedMove(block.items.map((item) => item.data)),
  }), []);

  const open = useCallback((asset: HeatmapAsset) => {
    pinTicker(asset.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [pinTicker]);

  const selectNeighbor = useCallback((direction: MetricTreemapDirection) => {
    const target = findMetricTreemapNeighbor(tiles, selected?.symbol ?? null, direction);
    if (target) setSelectedId(target.item.id);
  }, [selected, tiles]);

  useShortcut((event) => {
    if (!focused) return;
    const handled = (() => {
      if (isPlainKey(event, "r")) return void reload(), true;
      // As on core's HM: [ and ] step through the boards.
      if (isPlainKey(event, "[", "]")) {
        const step = isPlainKey(event, "]") ? 1 : -1;
        const next = HEATMAP_UNIVERSES[(HEATMAP_UNIVERSES.indexOf(universe) + step + HEATMAP_UNIVERSES.length) % HEATMAP_UNIVERSES.length]!;
        return setUniverse(next), true;
      }
      for (const [index, value] of HEATMAP_UNIVERSES.entries()) {
        if (isPlainKey(event, String(index + 1))) return setUniverse(value), true;
      }
      if (isPlainKey(event, "j")) return setSelectedId(tiles[Math.min(activeIndex + 1, tiles.length - 1)]?.item.id ?? null), true;
      if (isPlainKey(event, "k")) return setSelectedId(tiles[Math.max(activeIndex - 1, 0)]?.item.id ?? null), true;
      if (isPlainKey(event, "left", "h")) return selectNeighbor("left"), true;
      if (isPlainKey(event, "right", "l")) return selectNeighbor("right"), true;
      if (isPlainKey(event, "up")) return selectNeighbor("up"), true;
      if (isPlainKey(event, "down")) return selectNeighbor("down"), true;
      if (isPlainKey(event, "enter", "return") && selected) return open(selected), true;
      return false;
    })();
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const fallback = data ? fallbackNotice(data) : null;
  usePaneNoticeFooter({
    registrationId: `${HEATMAP_PANE_ID}:notices`,
    focused,
    notices: [
      ...(data?.missingQuotes ? [`${data.missingQuotes} names are missing because their quotes were refused${data.rateLimited ? " (Gloom Cloud's limit for signed-out use); sign in or wait a minute" : ""}. They are asked for again on the next refresh.`] : []),
      ...(data?.sectorsUnavailable ? [`The ASX company directory could not be loaded, so ${data.universe === "sectors" ? "the sectors are sized evenly" : "tiles have no sector"}. It is retried on the next refresh.`] : []),
      ...(data?.membersAsOf ? [`Index members as of ${new Date(data.membersAsOf).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" })}: TradingView's scanner is unavailable, so the last list it gave stands in.`] : []),
    ],
  });
  usePaneFooter(HEATMAP_PANE_ID, () => ({
    info: [
      ...(selected ? [{
        id: "selected",
        parts: [
          { text: selected.label, tone: "label" as const },
          { text: pct(selected.changePercent), tone: "value" as const, bold: true, ...(selected.changePercent != null ? { color: priceColor(selected.changePercent) } : {}) },
          ...(selected.price != null ? [{ text: universe === "sectors" ? level(selected.price) : `A$${selected.price < 1 ? selected.price.toFixed(3) : level(selected.price)}`, tone: "value" as const }] : []),
          ...(universe !== "sectors" && selected.size != null ? [{ text: `Mkt ${capLabel(selected.size)}`, tone: "muted" as const }] : []),
        ],
      }] : []),
      ...(fallback ? [{ id: "fallback", parts: [{ text: fallback, tone: "warning" as const }] }] : []),
      ...(updated ? [{ id: "updated", parts: [{ text: `updated ${updated}`, tone: "muted" as const }] }] : []),
      ...(loading && data ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      // Without a board the body carries the failure.
      ...((error || data?.refreshError) && data ? [{ id: "error", parts: [{ text: "refresh failed", tone: "warning" as const }] }] : []),
    ],
  }), [data, error, fallback, loading, selected, universe, updated]);

  // A Top 50 ranking is never labelled as the index; before the first answer the setting decides.
  const ranked = data ? data.ranked : source === "market-cap";
  const universeOptions = HEATMAP_UNIVERSES.map((value) => ({ value, label: universeLabel(value, ranked) }));
  // A pane too small to draw a single tile says so rather than showing nothing.
  const tooSmall = assets.length > 0 && tiles.length === 0;
  const emptyTitle = tooSmall ? "Enlarge the pane to draw the heatmap." : `No ${universeLabel(universe, ranked)} quotes.`;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <QueryBar
        width={width}
        filters={[
          { id: "universe", label: "Board", value: universe, options: universeOptions, onChange: (value) => setUniverse(value), inline: true },
          ...(universe === "sectors" ? [] : [{
            kind: "toggle" as const,
            id: "group",
            label: "Group by sector",
            short: "Grouped",
            value: groupSetting !== false,
            defaultValue: true,
            onChange: (value: boolean) => setGroupSetting(value),
          }]),
        ]}
      />
      <PaneStatusBody
        loading={loading && !data}
        loadingLabel={loadingText("ASX heatmap")}
        error={data ? null : error}
        errorTitle={unavailableText("ASX heatmap")}
        empty={!!data && (assets.length === 0 || tooSmall)}
        emptyTitle={emptyTitle}
      >
        <HeatmapSurface
          layout={layout}
          width={width}
          height={bodyHeight}
          selectedId={selected?.symbol ?? null}
          describeBlock={describeBlock}
          onSelect={(item) => setSelectedId(item.id)}
          onActivate={(item) => open(item.data)}
        />
      </PaneStatusBody>
    </Box>
  );
}
