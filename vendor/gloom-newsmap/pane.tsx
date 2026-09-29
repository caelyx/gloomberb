import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Box, Text, TextAttributes, useUiCapabilities } from "gloomberb/ui";
import {
  buildMetricTreemapNavigationTiles,
  findMetricTreemapNeighbor,
  loadingText,
  PaneStatusBody,
  useExternalLinkFooter,
  usePaneMenuItems,
  type MetricTreemapDirection,
  type MetricTreemapItem,
} from "gloomberb/components";
import {
  useAutoRefresh, usePaneSettingValue, usePaneVisible, usePluginPaneState,
  useShortcut, useUpdatedAgo,
} from "gloomberb/react";
import { colors } from "gloomberb/theme";
import { displayWidth, isPlainKey, padTo } from "gloomberb/utils";
import type { PaneProps } from "gloomberb/types/plugin";
import { cachedFeed, loadFeed } from "./cache";
import { gloomNewsAvailable, watchGloomNews } from "./gloom-news";
import {
  assignHues, DEFAULT_DENSITY, DEFAULT_EDITION_ID, DEFAULT_SECTIONS, DENSITIES, EDITIONS,
  editionById, isDensity, isSectionId, NEWSMAP_PANE_ID, sectionLabel,
  type Density, type Headline, type SourceId,
} from "./types";
import {
  dedupeHeadlines, freshness, mixHex, storyWeight, tileBudget, tileColor, tileLines,
  tileTextColor, topStories,
  type TilePalette,
} from "./model";

const GLOOM_NEWS_LIMIT = 150;
/** News does not move fast enough to justify more, and Google answers a
 * hammered feed with 503s. */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
/** How often the age ramp re-reads the clock while the pane is on screen. */
const AGE_TICK_MS = 60 * 1000;
/** Stable identities: `usePaneSettingValue` hands the fallback straight back
 * when a setting has never been written, and a literal here would be a new
 * value every render. */
const EMPTY_HIDDEN: string[] = [];
const DEFAULT_SECTION_SETTING: string[] = [...DEFAULT_SECTIONS];
const EMPTY_TITLE = "No stories.";

type Tile = { item: MetricTreemapItem<Headline>; x: number; y: number; width: number; height: number };
type PreventableMouseEvent = { preventDefault(): void };
type PointerMoveEvent = { x?: number; y?: number; pixelX?: number; pixelY?: number };

/**
 * Hover selects the tile under the pointer, but only when the pointer really
 * moved: the terminal re-sends "over" when tiles relayout under a resting
 * pointer, which would take the selection the keyboard just made.
 */
function usePointerMoved(): (event: PointerMoveEvent | undefined) => boolean {
  const lastRef = useRef<string | null>(null);
  return useCallback((event) => {
    const x = event?.pixelX ?? event?.x;
    const y = event?.pixelY ?? event?.y;
    if (typeof x !== "number" || typeof y !== "number") return true;
    const position = `${x}:${y}`;
    if (lastRef.current === position) return false;
    lastRef.current = position;
    return true;
  }, []);
}

/**
 * `colors` is a live proxy over the active theme, so reading it through a
 * getter keeps the palette current without allocating a new object on every
 * render — which is what previously invalidated every memo that depended on it
 * and made memoising the tiles pointless.
 */
const PALETTE: TilePalette = {
  get bg() { return colors.bg; },
  get text() { return colors.text; },
  get textBright() { return colors.textBright; },
  get selected() { return colors.selected; },
  get selectedText() { return colors.selectedText; },
};

// ------------------------------------------------------------------ tiles

const TerminalTile = memo(function TerminalTile({ tile, selected, background, palette, now, onSelect, onActivate, pointerMoved }: {
  tile: Tile;
  selected: boolean;
  background: string;
  palette: TilePalette;
  now: number;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  pointerMoved: (event: PointerMoveEvent | undefined) => boolean;
}) {
  // One cell of the tile's width and height is given back as a gutter, which
  // is what separates neighbouring tiles when their colours are close.
  const renderWidth = Math.max(1, tile.width - (tile.width > 2 ? 1 : 0));
  const renderHeight = Math.max(1, tile.height - (tile.height > 2 ? 1 : 0));
  // A cell of padding on each side: text flush against the left colour edge
  // reads as a continuation of the tile before it.
  const pad = renderWidth > 3 ? 1 : 0;
  const innerWidth = Math.max(1, renderWidth - 1 - pad);
  const fill = selected ? palette.selected : background;
  const textColor = tileTextColor(fill, palette);
  const lines = tileLines(tile.item.data, innerWidth, renderHeight, now, displayWidth);

  return (
    <Box
      position="absolute"
      left={tile.x}
      top={tile.y}
      width={renderWidth}
      height={renderHeight}
      backgroundColor={fill}
      onMouseDown={(event: PreventableMouseEvent) => {
        event.preventDefault();
        onSelect(tile.item.id);
      }}
      onMouseMove={(event: PointerMoveEvent) => {
        if (pointerMoved(event)) onSelect(tile.item.id);
      }}
      onMouseOver={(event: PointerMoveEvent & { source?: unknown }) => {
        if (event.source && pointerMoved(event)) onSelect(tile.item.id);
      }}
      onDoubleClick={() => onActivate(tile.item.id)}
    >
      {lines.map((line, index) => (
        <Text
          key={`${tile.item.id}:${index}`}
          fg={textColor}
          attributes={selected && index === 0 ? TextAttributes.BOLD : TextAttributes.NONE}
        >
          {`${" ".repeat(pad)}${padTo(line, innerWidth)}`}
        </Text>
      ))}
    </Box>
  );
});

function pct(value: number, total: number): string {
  return `${total > 0 ? (value / total) * 100 : 0}%`;
}

const DesktopTile = memo(function DesktopTile({ tile, chartWidth, chartHeight, cellHeightPx, selected, background, palette, now, onSelect, onActivate }: {
  tile: Tile;
  chartWidth: number;
  chartHeight: number;
  cellHeightPx: number;
  selected: boolean;
  background: string;
  palette: TilePalette;
  now: number;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const textColor = tileTextColor(background, palette);
  const tiny = tile.width < 5 || tile.height < 2;
  const headline = tile.item.data;
  // The browser ellipsizes, so the DOM tile gets the whole headline and a line
  // clamp rather than the terminal's hand-wrapped lines. The clamp counts CSS
  // lines, not terminal rows: measuring in rows ran about one line long, and
  // `overflow: hidden` then cut the last one mid-glyph instead of ellipsising.
  const fontSize = tiny ? 11 : 13;
  const lineHeightPx = fontSize * 1.2;
  const showsSource = tile.height >= 3.5;
  const boxPx = tile.height * cellHeightPx;
  const spentPx = (tiny ? 6 : 12) + (showsSource ? 13 + 2 : 0);
  const maxLines = Math.max(1, Math.floor((boxPx - spentPx) / lineHeightPx));

  const style: CSSProperties = {
    position: "absolute",
    left: `calc(${pct(tile.x, chartWidth)} + 1px)`,
    top: `calc(${pct(tile.y, chartHeight)} + 1px)`,
    width: `max(1px, calc(${pct(tile.width, chartWidth)} - 2px))`,
    height: `max(1px, calc(${pct(tile.height, chartHeight)} - 2px))`,
    padding: tiny ? "3px 4px" : "6px 8px",
    overflow: "hidden",
    borderRadius: 4,
    border: `1px solid ${selected ? colors.textBright : mixHex(background, colors.textBright, 0.12)}`,
    backgroundColor: background,
    color: textColor,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    cursor: "pointer",
  };

  return (
    <Box
      data-gloom-role="newsmap-tile"
      style={style}
      onMouseDown={(event: PreventableMouseEvent) => {
        event.preventDefault();
        onSelect(tile.item.id);
      }}
      onDoubleClick={() => onActivate(tile.item.id)}
    >
      <Text
        fg={textColor}
        attributes={selected ? TextAttributes.BOLD : TextAttributes.NONE}
        style={{
          display: "-webkit-box", WebkitLineClamp: maxLines, WebkitBoxOrient: "vertical",
          overflow: "hidden", fontSize, fontWeight: 600, lineHeight: 1.2,
        } as CSSProperties}
      >
        {headline.title}
      </Text>
      {showsSource && (
        <Text
          fg={textColor}
          style={{ opacity: 0.75, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {headline.source}
        </Text>
      )}
    </Box>
  );
});

// ----------------------------------------------------------------- legend

/** The age ramp, three cells of it, so "brighter is newer" is legible without
 * the README. */
function AgeKey({ hue }: { hue: string }) {
  return (
    <Box flexDirection="row">
      <Text fg={colors.textMuted}>{"new "}</Text>
      {[1, 0.55, 0.15].map((freshnessLevel) => (
        <Text key={freshnessLevel} fg={tileColor(hue, freshnessLevel, PALETTE)}>{"\u2588"}</Text>
      ))}
      <Text fg={colors.textMuted}>{" old"}</Text>
    </Box>
  );
}

/**
 * Names each hue on the board and doubles as the section filter: the number is
 * the key that toggles it. What does not fit is dropped from the end, never
 * from the middle — a hue still on the map with no entry here is a key the
 * reader cannot read.
 */
function Legend({ groups, hues, active, width, onToggle }: {
  groups: readonly string[];
  hues: Map<string, string>;
  active: ReadonlySet<string>;
  width: number;
  onToggle: (group: string) => void;
}) {
  const ageKeyWidth = 11;
  const chips: Array<{ group: string; label: string }> = [];
  let used = 0;
  for (const [index, group] of groups.entries()) {
    const label = `${index + 1} ${sectionLabel(group)}`;
    const chipWidth = displayWidth(label) + 3;
    if (used + chipWidth > width) break;
    used += chipWidth;
    chips.push({ group, label });
  }
  // Short labels before dropping a hue off the key entirely.
  const abbreviate = chips.length < groups.length;

  return (
    <Box flexDirection="row" height={1} paddingX={1}>
      {chips.map(({ group, label }) => {
        const on = active.has(group);
        const text = abbreviate ? label.slice(0, 2) : label;
        return (
          <Box key={group} flexDirection="row" onMouseDown={() => onToggle(group)}>
            <Text fg={on ? (hues.get(group) ?? colors.neutral) : colors.textMuted}>
              {on ? "\u25a0 " : "\u25a1 "}
            </Text>
            <Text fg={on ? colors.text : colors.textMuted}>{`${text}  `}</Text>
          </Box>
        );
      })}
      {used + ageKeyWidth <= width && (
        <AgeKey hue={hues.get(chips[0]?.group ?? "") ?? colors.neutral} />
      )}
    </Box>
  );
}

// ------------------------------------------------------------------- pane

export function NewsmapPane({ focused, width, height }: PaneProps) {
  const { cellWidthPx = 8, cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  const pointerMoved = usePointerMoved();

  const [source, setSource] = usePaneSettingValue<SourceId>("source", "google");
  const [editionId, setEditionId] = usePaneSettingValue<string>("edition", DEFAULT_EDITION_ID);
  const [sections, setSections] = usePaneSettingValue<string[]>("sections", DEFAULT_SECTION_SETTING);
  const [density, setDensity] = usePaneSettingValue<Density>("density", DEFAULT_DENSITY);

  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const paneVisible = usePaneVisible();
  // Which sections are hidden survives a reload and a restored layout: it is a
  // filter the user set deliberately, not scroll position.
  const [hidden, setHidden] = usePluginPaneState<string[]>("hidden", EMPTY_HIDDEN);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fetchGenRef = useRef(0);

  // `usePaneSettingValue` returns the fallback by identity when the setting has
  // never been written, so an array literal here would be a new array every
  // render — which cascaded into a new loader, a re-run effect, a fetch, a
  // state change, and round again. Keying on a string keeps it stable.
  const sectionsKey = useMemo(() => {
    const chosen = sections.filter(isSectionId);
    return (chosen.length > 0 ? chosen : DEFAULT_SECTIONS).join(",");
  }, [sections]);
  const activeSections = useMemo(() => sectionsKey.split(","), [sectionsKey]);
  const hiddenGroups = useMemo(() => new Set(hidden), [hidden]);

  // Declared before the loaders so it runs first: a source that delivers its
  // first snapshot synchronously on subscribe would otherwise have it wiped.
  useEffect(() => {
    setHeadlines([]);
    setSelectedId(null);
    setError(null);
  }, [source]);

  const loadGoogle = useCallback(async ({ force = false } = {}) => {
    fetchGenRef.current += 1;
    const generation = fetchGenRef.current;
    setLoading(true);
    try {
      const result = await loadFeed(activeSections, editionId, { force });
      // A switch of source or edition, or an unmount, bumps the generation, so
      // a slow answer cannot land on a board it no longer describes.
      if (fetchGenRef.current !== generation) return;
      setHeadlines(result.headlines);
      setNow(Date.now());
      setUpdatedAt(result.fetchedAt);
      setError(
        result.headlines.length === 0
          ? "Google News returned nothing for this edition."
          : result.failedSections.length > 0
            ? `${result.failedSections.map(sectionLabel).join(", ")} unavailable`
            : null,
      );
    } catch (cause) {
      if (fetchGenRef.current !== generation) return;
      setError(cause instanceof Error ? cause.message : "Could not reach Google News.");
    } finally {
      if (fetchGenRef.current === generation) setLoading(false);
    }
  }, [activeSections, editionId]);

  const refresh = useCallback(() => {
    if (source === "google") void loadGoogle({ force: true });
  }, [loadGoogle, source]);

  useEffect(() => {
    if (source !== "google") return;
    // Paint the last board straight from cache, so a re-opened pane is not a
    // spinner while four feeds come back.
    const cached = cachedFeed(activeSections, editionId);
    if (cached && cached.headlines.length > 0) setHeadlines(cached.headlines);
    void loadGoogle();
    return () => { fetchGenRef.current += 1; };
  }, [activeSections, editionId, loadGoogle, source]);

  // Visibility-gated, and on the interval the user configured: a covered or
  // backgrounded pane stops fetching entirely.
  useAutoRefresh(updatedAt, refresh, { intervalMs: REFRESH_INTERVAL_MS });

  useEffect(() => {
    if (source !== "gloom") return;
    setLoading(true);
    // The host pushes state; there is nothing to poll.
    return watchGloomNews(GLOOM_NEWS_LIMIT, (snapshot) => {
      setHeadlines(snapshot.headlines);
      setLoading(snapshot.loading);
      setError(snapshot.error);
      setUpdatedAt(snapshot.updatedAt);
      setNow(Date.now());
    });
  }, [source]);

  // Merged section feeds repeat stories; dedupe before anything counts them.
  const stories = useMemo(() => dedupeHeadlines(headlines), [headlines]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    for (const headline of stories) seen.add(headline.section);
    return source === "google"
      ? activeSections.filter((section) => seen.has(section))
      // Sorted, not insertion-ordered: the host reorders its articles between
      // pushes, which would renumber the legend under the reader's fingers.
      : [...seen].sort();
  }, [activeSections, source, stories]);

  const hues = useMemo(() => assignHues(groups), [groups]);
  const visible = useMemo(
    () => stories.filter((headline) => !hiddenGroups.has(headline.section)),
    [hiddenGroups, stories],
  );

  const budget = tileBudget(
    Math.max(1, width - 2),
    Math.max(1, height - (groups.length > 0 ? 1 : 0)),
    isDensity(density) ? density : DEFAULT_DENSITY,
  );
  const board = useMemo(() => topStories(visible, budget), [budget, visible]);

  const items = useMemo<Array<MetricTreemapItem<Headline>>>(
    () => board.map((headline) => ({
      id: headline.id,
      label: headline.title,
      weight: storyWeight(headline),
      data: headline,
    })),
    [board],
  );

  // Kept even for a single section: it is the only thing on screen that says
  // what the colour and the fade mean.
  const legendHeight = groups.length > 0 ? 1 : 0;
  const chartHeight = Math.max(1, height - legendHeight);
  const chartWidth = Math.max(1, width - 2);
  const cellAspect = Math.max(0.5, Math.min(4, cellHeightPx / Math.max(1, cellWidthPx)));

  const tiles = useMemo(
    () => buildMetricTreemapNavigationTiles(
      items, chartWidth, chartHeight, cellAspect, nativePaneChrome ? "float" : "integer",
    ) as Tile[],
    [cellAspect, chartHeight, chartWidth, items, nativePaneChrome],
  );

  // Selection follows what is drawn, not what was budgeted. The layout drops
  // tiles that would fall below its minimum size, so a story can be on the
  // board and not on the screen — and selecting one of those left no highlight
  // anywhere while Enter opened a story the reader could not see.
  useEffect(() => {
    if (selectedId && tiles.some((tile) => tile.item.id === selectedId)) return;
    setSelectedId(tiles[0]?.item.id ?? null);
  }, [selectedId, tiles]);

  const selected = useMemo(
    () => tiles.find((tile) => tile.item.id === selectedId)?.item.data ?? null,
    [selectedId, tiles],
  );

  const backgroundFor = useCallback(
    (headline: Headline) => tileColor(
      hues.get(headline.section) ?? colors.neutral,
      freshness(headline.publishedAt, now),
      PALETTE,
    ),
    [hues, now],
  );

  // useExternalLinkFooter owns the open; the ref mirrors it onto Enter and
  // double-click, which it does not bind itself.
  const openRef = useRef<(() => void) | null>(null);

  const selectTile = useCallback((id: string) => setSelectedId(id), []);
  const activateTile = useCallback((id: string) => {
    setSelectedId(id);
    openRef.current?.();
  }, []);

  const selectNeighbor = useCallback((direction: MetricTreemapDirection) => {
    const target = findMetricTreemapNeighbor(tiles, selectedId, direction);
    if (target) setSelectedId(target.item.id);
  }, [selectedId, tiles]);

  // Walks the drawn tiles, in weight order, so j/k never lands on a story that
  // has no tile and appears to do nothing.
  const step = useCallback((delta: 1 | -1) => {
    const index = tiles.findIndex((tile) => tile.item.id === selectedId);
    const next = tiles[Math.min(Math.max((index < 0 ? 0 : index) + delta, 0), tiles.length - 1)];
    if (next) setSelectedId(next.item.id);
  }, [selectedId, tiles]);

  const toggleGroup = useCallback((group: string) => {
    setHidden((current) => (current.includes(group)
      ? current.filter((id) => id !== group)
      : [...current, group]));
  }, [setHidden]);

  const shiftEdition = useCallback((delta: 1 | -1) => {
    const index = EDITIONS.findIndex((edition) => edition.id === editionId);
    const next = EDITIONS[Math.min(Math.max((index < 0 ? 0 : index) + delta, 0), EDITIONS.length - 1)];
    if (next && next.id !== editionId) {
      setEditionId(next.id);
      setSelectedId(null);
    }
  }, [editionId, setEditionId]);

  const cycleDensity = useCallback(() => {
    const index = DENSITIES.findIndex((option) => option.id === density);
    setDensity(DENSITIES[(index < 0 ? 0 : index + 1) % DENSITIES.length]!.id);
  }, [density, setDensity]);

  const toggleSource = useCallback(() => {
    setSource((current) => (current === "google" ? "gloom" : "google"));
  }, [setSource]);

  useShortcut((event) => {
    if (!focused || event.targetEditable) return;
    const take = () => { event.preventDefault(); event.stopPropagation(); };

    // Only claimed when it has something to do; the gloom feed is pushed by
    // the host, so `r` there belongs to the app.
    if (isPlainKey(event, "r") && source === "google") { take(); refresh(); return; }
    if (isPlainKey(event, "g")) { take(); toggleSource(); return; }
    if (isPlainKey(event, "d")) { take(); cycleDensity(); return; }
    if (isPlainKey(event, "[")) { take(); shiftEdition(-1); return; }
    if (isPlainKey(event, "]")) { take(); shiftEdition(1); return; }
    if (isPlainKey(event, "0")) { take(); setHidden(EMPTY_HIDDEN); return; }
    for (let index = 0; index < Math.min(groups.length, 9); index += 1) {
      if (isPlainKey(event, String(index + 1))) { take(); toggleGroup(groups[index]!); return; }
    }
    if (isPlainKey(event, "left")) { take(); selectNeighbor("left"); return; }
    if (isPlainKey(event, "right")) { take(); selectNeighbor("right"); return; }
    if (isPlainKey(event, "up")) { take(); selectNeighbor("up"); return; }
    if (isPlainKey(event, "down")) { take(); selectNeighbor("down"); return; }
    if (isPlainKey(event, "j")) { take(); step(1); return; }
    if (isPlainKey(event, "k")) { take(); step(-1); return; }
    if (isPlainKey(event, "enter", "return") && selected) { take(); openRef.current?.(); }
  });

  useEffect(() => {
    if (!paneVisible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [paneVisible]);

  const activeGroups = useMemo(
    () => new Set(groups.filter((group) => !hiddenGroups.has(group))),
    [groups, hiddenGroups],
  );
  const updated = useUpdatedAgo(updatedAt);
  const hasBoard = tiles.length > 0;
  const sourceLabel = source === "google"
    ? `Google News · ${editionById(editionId).label}`
    : "Gloomberb news";

  // Every key the pane binds, in one place the keyboard can find. Only `o` and
  // the two cycling controls have footer hints; without this the arrows, j/k,
  // the digits and `[` exist only in the README.
  usePaneMenuItems(`${NEWSMAP_PANE_ID}:menu`, () => [
    { id: "open", label: "Open story", accelerator: "Enter", enabled: !!selected, onSelect: () => openRef.current?.() },
    { id: "move", label: "Move between tiles", accelerator: "Arrows", enabled: false },
    { id: "step", label: "Next / previous by weight", accelerator: "j / k", enabled: false },
    ...(source === "google"
      ? [
        { id: "refresh", label: "Refresh", accelerator: "r", onSelect: refresh },
        { id: "edition", label: `Edition: ${editionById(editionId).label}`, accelerator: "[ / ]", onSelect: () => shiftEdition(1) },
      ]
      : []),
    { id: "source", label: source === "google" ? "Switch to Gloomberb news" : "Switch to Google News", accelerator: "g", onSelect: toggleSource },
    {
      id: "density",
      label: "Density",
      accelerator: "d",
      submenu: DENSITIES.map((option) => ({
        id: `density:${option.id}`,
        label: option.label,
        checked: option.id === density,
        onSelect: () => setDensity(option.id),
      })),
    },
    ...(groups.length > 0
      ? [{
        id: "sections",
        label: "Sections",
        submenu: groups.map((group, index) => ({
          id: `section:${group}`,
          label: sectionLabel(group),
          accelerator: String(index + 1),
          checked: !hiddenGroups.has(group),
          onSelect: () => toggleGroup(group),
        })),
      }]
      : []),
    { id: "show-all", label: "Show every section", accelerator: "0", enabled: hiddenGroups.size > 0, onSelect: () => setHidden(EMPTY_HIDDEN) },
  ], [density, editionId, groups, hiddenGroups, refresh, selected, setDensity, setHidden, shiftEdition, source, toggleGroup, toggleSource]);

  openRef.current = useExternalLinkFooter({
    registrationId: NEWSMAP_PANE_ID,
    focused,
    url: selected?.url ?? null,
    source: selected?.source ?? null,
    label: "story",
    info: [
      { id: "feed", parts: [{ text: sourceLabel, tone: "muted" as const }] },
      ...(updated ? [{ id: "updated", parts: [{ text: `updated ${updated}`, tone: "muted" as const }] }] : []),
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error && hasBoard ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      ...(source === "google"
        ? [{ id: "edition", key: "]", label: " edition", onPress: () => shiftEdition(1) }]
        : []),
      { id: "source", key: "g", label: " source", onPress: toggleSource },
    ],
  });

  const body = nativePaneChrome ? (
    <Box style={{ position: "relative", width: "100%", flexGrow: 1, minHeight: 0, backgroundColor: colors.bg }}>
      {tiles.map((tile) => (
        <DesktopTile
          key={tile.item.id}
          tile={tile}
          chartWidth={chartWidth}
          chartHeight={chartHeight}
          cellHeightPx={cellHeightPx}
          selected={tile.item.id === selectedId}
          background={tile.item.id === selectedId ? colors.selected : backgroundFor(tile.item.data)}
          palette={PALETTE}
          now={now}
          onSelect={selectTile}
          onActivate={activateTile}
        />
      ))}
    </Box>
  ) : (
    <Box width={width} height={chartHeight} paddingX={1} backgroundColor={colors.bg}>
      <Box position="relative" width={chartWidth} height={chartHeight} backgroundColor={colors.bg}>
        {tiles.map((tile) => (
          <TerminalTile
            key={tile.item.id}
            tile={tile}
            selected={tile.item.id === selectedId}
            background={backgroundFor(tile.item.data)}
            palette={PALETTE}
            now={now}
            onSelect={() => setSelectedId(tile.item.id)}
            onActivate={() => { setSelectedId(tile.item.id); openRef.current?.(); }}
            pointerMoved={pointerMoved}
          />
        ))}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" width={width} height={height}>
      {legendHeight > 0 && (
        <Legend
          groups={groups}
          hues={hues}
          active={activeGroups}
          width={Math.max(0, width - 4)}
          onToggle={toggleGroup}
        />
      )}
      <PaneStatusBody
        loading={loading && !hasBoard}
        loadingLabel={loadingText("news")}
        error={hasBoard ? null : error}
        empty={!hasBoard}
        emptyTitle={source === "gloom" && !gloomNewsAvailable() ? "Gloomberb news is unavailable here." : EMPTY_TITLE}
      >
        {body}
      </PaneStatusBody>
    </Box>
  );
}
