import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  DataTableStackView,
  DetailScrollBody,
  ExternalLink,
  PaneLinkMenu,
  activeStackIndex,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type FeedDataTableItem,
  type StackSortPreference,
} from "gloomberb/components";
import { t, useAppLanguage } from "gloomberb/i18n";
import { colors } from "gloomberb/theme";
import { Box, Text, TextAttributes, type ScrollBoxRenderable } from "gloomberb/ui";
import { nextHeaderSort, wrapTextLines } from "gloomberb/utils";
import { feedColumns, feedTimeText, sortFeedRows, type FeedColumn, type FeedColumnId, type FeedRow } from "./company-model";

interface SydneyFeedStackViewProps {
  width: number;
  height: number;
  focused: boolean;
  items: FeedDataTableItem[];
  selectedIdx: number;
  onSelect: (index: number) => void;
  openItemId: string | null;
  onOpenItemIdChange: (itemId: string | null) => void;
  rootBefore?: ReactNode;
  onRootKeyDown?: (event: DataTableKeyEvent, context: DataTableRootKeyContext) => boolean | void;
  sourceLabel: string;
  titleLabel: string;
  emptyStateTitle: string;
  emptyStateHint?: string;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  onBodyScrollActivity?: () => void;
}

/*
 * Core's FeedDataTableStackView with one change: the time column is Sydney
 * time (`08 Oct 09:23`, `08 Oct 2025`), as in the ASXA market pane, instead of
 * the host's US-format age, and the detail wraps clear of the scrollbar. Drop it once core's feed view takes a time
 * formatter (STATUS core to-do).
 */
export function SydneyFeedStackView({
  width,
  height,
  focused,
  items,
  selectedIdx,
  onSelect,
  openItemId,
  onOpenItemIdChange,
  rootBefore,
  onRootKeyDown,
  sourceLabel,
  titleLabel,
  emptyStateTitle,
  emptyStateHint,
  scrollRef,
  onBodyScrollActivity,
}: SydneyFeedStackViewProps) {
  const language = useAppLanguage();
  const [sort, setSort] = useState<StackSortPreference<FeedColumnId>>({ columnId: "time", direction: "desc" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); }, [items]);
  const detailScrollRef = useRef<ScrollBoxRenderable>(null);
  // Core wraps at width - 2, which loses a line's last character under the scrollbar.
  const detailTextWidth = Math.max(width - 4, 12);
  const columns = useMemo(
    () => feedColumns(width, t(sourceLabel), t(titleLabel), items),
    [items, language, sourceLabel, titleLabel, width],
  );
  const rows = useMemo(() => sortFeedRows(items, sort), [items, sort]);
  const activeRowIndex = activeStackIndex(rows.length, rows.findIndex((row) => row.itemIndex === selectedIdx));
  const openItem = useMemo(() => (openItemId ? items.find((item) => item.id === openItemId) ?? null : null), [items, openItemId]);

  const openRow = useCallback((row: FeedRow | undefined) => {
    if (row) onOpenItemIdChange(row.item.id);
  }, [onOpenItemIdChange]);

  // Reading on: the next or previous item opens in place, and the list cursor follows it.
  const openRowIndex = openItem ? rows.findIndex((row) => row.item.id === openItem.id) : -1;
  const openAdjacent = useCallback((step: 1 | -1) => {
    const row = openRowIndex >= 0 ? rows[openRowIndex + step] : undefined;
    if (!row) return;
    onSelect(row.itemIndex);
    openRow(row);
  }, [onSelect, openRow, openRowIndex, rows]);
  const footerId = `au-feed-detail:${useId()}`;
  usePaneFooter(footerId, () => (focused && openRowIndex >= 0 ? {
    order: 1,
    hints: [
      { id: "feed-next", key: "n", label: "ext", title: "Next Item", disabled: openRowIndex >= rows.length - 1, onPress: () => openAdjacent(1) },
      { id: "feed-previous", key: "p", label: "rev", title: "Previous Item", disabled: openRowIndex <= 0, onPress: () => openAdjacent(-1) },
    ],
  } : null), [focused, openAdjacent, openRowIndex, rows.length]);

  useEffect(() => {
    if (items.length > 0 && selectedIdx >= items.length) onSelect(Math.max(0, items.length - 1));
  }, [items.length, onSelect, selectedIdx]);

  const renderCell = useCallback((row: FeedRow, column: FeedColumn, _index: number, state: { selected: boolean }): DataTableCell => {
    switch (column.id) {
      case "time": return { text: feedTimeText(row.item, now), color: colors.textDim };
      case "source": return { text: row.item.eyebrow ?? "", color: colors.textMuted };
      case "title": return { text: row.item.title, color: colors.text, attributes: state.selected ? TextAttributes.BOLD : TextAttributes.NONE };
    }
  }, [now]);

  const detailContent = openItem ? (
    <DetailScrollBody ref={detailScrollRef} resetScrollKey={openItem.id}>
      <Box flexDirection="column">
        {(openItem.detailMeta ?? [])
          .flatMap((entry) => wrapTextLines(entry, detailTextWidth, 2))
          .map((line, index) => (
            <Box key={`meta-${index}`} height={1}>
              <Text fg={colors.textMuted}>{line}</Text>
            </Box>
          ))}
        <Box height={1} />
        {wrapTextLines(openItem.detailBody ?? "", detailTextWidth).map((line, index) => (
          <Box key={`body-${index}`} height={1}>
            <Text fg={colors.text}>{line}</Text>
          </Box>
        ))}
        {openItem.detailNote ? (
          <>
            <Box height={1} />
            {wrapTextLines(openItem.detailNote, detailTextWidth).map((line, index) => (
              /^https?:\/\/\S+$/.test(line.trim())
                ? <ExternalLink key={`note-${index}`} url={line.trim()} />
                : (
                  <Box key={`note-${index}`} height={1}>
                    <Text fg={colors.textDim}>{line}</Text>
                  </Box>
                )
            ))}
          </>
        ) : null}
      </Box>
    </DetailScrollBody>
  ) : <Box flexGrow={1} />;

  return (
    <DataTableStackView<FeedRow, FeedColumn>
      focused={focused}
      detailOpen={!!openItem}
      onBack={() => onOpenItemIdChange(null)}
      detailContent={<PaneLinkMenu>{detailContent}</PaneLinkMenu>}
      detailTitle={openItem ? openItem.detailTitle ?? openItem.title : undefined}
      selection={{ kind: "index", selectedIndex: activeRowIndex, onChange: (_index, row) => onSelect(row.itemIndex) }}
      onActivate={(row) => openRow(row)}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={onRootKeyDown}
      detailScrollRef={detailScrollRef}
      columns={columns}
      items={rows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => nextHeaderSort(current, columnId as FeedColumnId, { firstDirection: columnId === "time" ? "desc" : "asc" }))}
      getItemKey={(row) => row.item.id}
      renderCell={renderCell}
      selectedTextOverridesCellColor
      emptyStateTitle={t(emptyStateTitle)}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
