import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DataTableView,
  PaneStatusBody,
  type DataTableKeyEvent,
} from "gloomberb/components";
import { useShortcut } from "gloomberb/react";
import { Box } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import type { AsxAnnouncement } from "./model";
import {
  DEFAULT_ANNOUNCEMENT_SORT,
  buildAnnouncementColumns,
  nextAnnouncementSort,
  renderAnnouncementCell,
  sortAnnouncements,
  type AnnouncementColumn,
  type AnnouncementSort,
} from "./table";

const EMPTY: AsxAnnouncement[] = [];

export interface AnnouncementsTableProps {
  rows: AsxAnnouncement[] | null;
  loading: boolean;
  error: string | null;
  focused: boolean;
  width: number;
  height: number;
  showCode: boolean;
  /** Rows before the table (a query bar, a tab strip), already counted out of `height`. */
  before?: ReactNode;
  beforeRows?: number;
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
  onActivate: (row: AsxAnnouncement) => void;
  onRefresh: () => void;
  loadingLabel: string;
  errorTitle: string;
  emptyTitle: string;
}

/** Released, code, price-sensitive flag, type, headline: one table for the market feed and one company. */
export function AnnouncementsTable({
  rows,
  loading,
  error,
  focused,
  width,
  height,
  showCode,
  before,
  beforeRows = 0,
  selectedId,
  onSelectedIdChange,
  onActivate,
  onRefresh,
  loadingLabel,
  errorTitle,
  emptyTitle,
}: AnnouncementsTableProps) {
  const [sort, setSort] = useState<AnnouncementSort>(DEFAULT_ANNOUNCEMENT_SORT);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); }, [rows]);

  const items = useMemo(() => sortAnnouncements(rows ?? EMPTY, sort), [rows, sort]);
  const showPages = items.some((row) => row.pages != null);
  const columns = useMemo(() => buildAnnouncementColumns(width, { showCode, showPages }), [showCode, showPages, width]);

  useEffect(() => {
    if (selectedId && items.some((row) => row.id === selectedId)) return;
    onSelectedIdChange(items[0]?.id ?? null);
  }, [items, onSelectedIdChange, selectedId]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    onRefresh();
    return true;
  }, [onRefresh]);

  // `r` refreshes even while the body shows a loading or failed state.
  useShortcut((event) => {
    if (event.targetEditable || event.defaultPrevented || event.propagationStopped) return;
    handleKey(event as DataTableKeyEvent);
  }, { enabled: focused && rows === null });

  const renderCell = useCallback(
    (row: AsxAnnouncement, column: AnnouncementColumn) => renderAnnouncementCell(row, column, now),
    [now],
  );

  if (rows === null) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {before}
        {loading || !error
          ? <PaneStatusBody loading align="center" loadingLabel={loadingLabel} />
          : <PaneStatusBody error={error} errorTitle={errorTitle} />}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {before}
      <DataTableView<AsxAnnouncement, AnnouncementColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={Math.max(1, height - beforeRows)}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => onSelectedIdChange(id),
        }}
        onRootKeyDown={handleKey}
        columns={columns}
        items={items}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextAnnouncementSort(current, columnId))}
        getItemKey={(row) => row.id}
        onActivate={onActivate}
        renderCell={renderCell}
        selectedTextOverridesCellColor
        emptyStateTitle={emptyTitle}
      />
    </Box>
  );
}
