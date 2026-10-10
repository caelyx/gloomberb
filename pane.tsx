import { useCallback, useMemo, useState } from "react";
import {
  DataTableStackView,
  PaneStatusBody,
  QueryBar,
  useExternalLinkFooter,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
  type QueryBarSearchFocus,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, useCapabilityInvoker, usePluginPaneState, useShortcut, useUpdatedAgo } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box } from "gloomberb/ui";
import { isPlainArrowUp, isPlainKey, stopSearchFocusNavigation } from "gloomberb/utils";
import { ABC_VIDEO_CAPABILITY_ID } from "./capability";
import { ABC_LIVE_URL } from "./channel";
import { VideoPlayer } from "./player";
import type { AbcStory } from "./types";

type TabId = "live" | "stories";

const TABS = [
  { label: "Live", value: "live" },
  { label: "Stories", value: "stories" },
];
const REFRESH_MS = 5 * 60_000;

type Column = DataTableColumn & { id: "age" | "title" };

const COLUMNS: Column[] = [
  { id: "age", label: "AGE", width: 5, align: "right" },
  { id: "title", label: "TITLE", width: 20, align: "left", flexGrow: 1 },
];

/** "42m", "3h", "2d": the AGE header already says how old, so no "ago". */
function formatAge(publishedAt: number): string {
  const minutes = Math.floor((Date.now() - publishedAt) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Every word must appear in the title or the summary, in any order. */
function matchesQuery(story: AbcStory, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${story.title} ${story.summary ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function renderCell(story: AbcStory, column: Column, selected: boolean): DataTableCell {
  const selectedColor = selected ? colors.selectedText : undefined;
  return column.id === "age"
    ? { text: formatAge(story.publishedAt), color: selectedColor ?? colors.textDim }
    : { text: story.title, color: selectedColor ?? colors.text };
}

export function AbcNewsPane({ paneId, focused, width, height }: PaneProps) {
  const [tab, setTab] = usePluginPaneState<TabId>("tab", "live");
  // The open story travels with the pane state so it survives a restart. The
  // story itself is kept, not just its id: the list only reaches back about
  // two days, so an id alone would stop resolving after a longer break.
  const [openStory, setOpenStory] = usePluginPaneState<AbcStory | null>("openStory", null);
  const storyOpen = tab === "stories" && !!openStory;
  // Held here, not in the Stories tab, because the strip must not take h and
  // l while they are being typed into the search.
  const search = useQueryBarSearch();
  const { blur: blurSearch } = search;
  const selectTab = useCallback((value: string) => {
    if (value !== "live" && value !== "stories") return;
    // A tab clicked mid-search must not leave the field owning the keyboard
    // when Stories comes back.
    blurSearch();
    setTab(value);
  }, [blurSearch, setTab]);
  const { strip, rows } = usePaneTabs({
    tabs: TABS,
    activeValue: tab,
    onSelect: selectTab,
    // The strip yields h/l to the detail while a story is open.
    focused: focused && !storyOpen && !(tab === "stories" && search.active),
    compact: true,
    variant: "bare",
  });
  const bodyHeight = Math.max(1, height - rows);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {strip && <Box height={1} paddingX={1}>{strip}</Box>}
      {/* One body at a time: the inactive tab holds no player and no poll. */}
      {tab === "live" ? (
        <VideoPlayer
          paneId={paneId}
          focused={focused}
          width={width}
          height={bodyHeight}
          source={{ kind: "live" }}
          openUrl={ABC_LIVE_URL}
        />
      ) : (
        <StoriesTab
          paneId={paneId}
          focused={focused}
          width={width}
          height={bodyHeight}
          openStory={openStory}
          setOpenStory={setOpenStory}
          search={search}
        />
      )}
    </Box>
  );
}

interface StoriesTabProps {
  paneId: string;
  focused: boolean;
  width: number;
  height: number;
  openStory: AbcStory | null;
  setOpenStory: (story: AbcStory | null) => void;
  search: QueryBarSearchFocus;
}

function StoriesTab({ paneId, focused, width, height, openStory, setOpenStory, search }: StoriesTabProps) {
  const capabilities = useCapabilityInvoker();
  const loader = useCallback(
    (force: boolean) => capabilities.invokeCapability<AbcStory[]>(ABC_VIDEO_CAPABILITY_ID, "stories", { force }),
    [capabilities],
  );
  const { data, loading, error, updatedAt, reload } = useAsyncResource(loader);
  useAutoRefresh(updatedAt, () => { void reload(); }, { intervalMs: REFRESH_MS });
  const updatedAgo = useUpdatedAgo(updatedAt);

  const [query, setQuery] = useState("");
  const searching = search.active;
  const stories = useMemo(() => (data ?? []).filter((story) => matchesQuery(story, query)), [data, query]);
  // Back from a story lands on its row.
  const [selectedId, setSelectedId] = useState<string | null>(openStory?.id ?? null);
  // Set by Enter, so only a story opened in this session starts the terminal
  // player; one restored from the layout waits for `p`.
  const [playRequestId, setPlayRequestId] = useState<string | null>(null);
  const selected = useMemo(
    () => stories.find((story) => story.id === selectedId) ?? stories[0] ?? null,
    [selectedId, stories],
  );
  const detailOpen = !!openStory;

  const info: PaneFooterSegment[] = [];
  if (!detailOpen) {
    if (loading) info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    else if (error && data) info.push({ id: "error", parts: [{ text: "refresh failed", tone: "warning" }] });
    else if (updatedAgo) info.push({ id: "updated", parts: [{ text: updatedAgo, tone: "muted" }] });
  }

  // In the list `o` opens the highlighted story; in the detail the player owns `o`.
  useExternalLinkFooter({
    registrationId: `${paneId}:stories`,
    focused: focused && !detailOpen && !searching,
    url: detailOpen ? null : selected?.watchUrl,
    info,
  });

  // In the detail the player owns `r`, re-resolving the story's video.
  useShortcut((event) => {
    if (!focused || detailOpen || searching || event.defaultPrevented || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void reload();
  });

  const back = useCallback(() => {
    setPlayRequestId(null);
    setOpenStory(null);
  }, [setOpenStory]);

  // Up from the first row goes back to the search, as Down left it.
  const { focus: focusSearch, blur: blurSearch } = search;
  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex > 0 || !isPlainArrowUp(event)) return false;
    stopSearchFocusNavigation(event);
    focusSearch();
    return true;
  }, [focusSearch]);

  // `/` in a story goes back to the list and searches it.
  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (!isPlainKey(event, "/")) return false;
    event.preventDefault?.();
    back();
    focusSearch();
    return true;
  }, [back, focusSearch]);

  return (
    <PaneStatusBody
      align="center"
      loading={loading && !data}
      error={error && !data ? "Retries automatically." : null}
      errorTitle="ABC News stories are unavailable."
    >
      <DataTableStackView<AbcStory, Column>
        focused={focused && !searching}
        detailOpen={detailOpen}
        onBack={back}
        detailTitle={openStory?.title}
        detailContent={openStory ? (
          <VideoPlayer
            key={openStory.id}
            paneId={paneId}
            focused={focused}
            width={width}
            // The stack bar naming the story takes one row.
            height={Math.max(1, height - 1)}
            source={{ kind: "story", story: openStory }}
            openUrl={openStory.watchUrl}
            autoPlay={playRequestId === openStory.id}
          />
        ) : null}
        selection={{
          kind: "id",
          selectedId: selected?.id ?? null,
          getId: (story) => story.id,
          onChange: setSelectedId,
        }}
        rootBefore={(
          <QueryBar
            width={width}
            search={{
              value: query,
              onChange: setQuery,
              placeholder: "Search stories",
              focused: focused && !detailOpen,
              ...search.searchProps,
            }}
          />
        )}
        onRootKeyDown={handleRootKeyDown}
        onDetailKeyDown={handleDetailKeyDown}
        resetScrollKey={query}
        onActivate={(story) => {
          blurSearch();
          setPlayRequestId(story.id);
          setOpenStory(story);
        }}
        rootWidth={width}
        rootHeight={height}
        columns={COLUMNS}
        items={stories}
        getItemKey={(story) => story.id}
        // The feed arrives newest first, which is the order a news list wants.
        sortColumnId={null}
        sortDirection="desc"
        renderCell={(story, column, _index, rowState) => renderCell(story, column, rowState.selected)}
        emptyStateTitle={query.trim() ? "No matching stories." : "No stories."}
      />
    </PaneStatusBody>
  );
}
