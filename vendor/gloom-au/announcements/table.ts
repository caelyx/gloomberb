import type { DataTableCell, DataTableColumn } from "gloomberb/components";
import { colors } from "gloomberb/theme";
import { TextAttributes } from "gloomberb/ui";
import { compareSortValues, type SortPreference } from "gloomberb/utils";
import { formatReleased } from "../shared/time";
import { CATEGORY_SHORT, type AsxAnnouncement } from "./model";

export type AnnouncementColumnId = "released" | "code" | "sensitive" | "type" | "headline" | "pages";
export type AnnouncementColumn = DataTableColumn & { id: AnnouncementColumnId };
export type AnnouncementSort = SortPreference<AnnouncementColumnId>;

/** Newest first: announcements are read as a feed. */
export const DEFAULT_ANNOUNCEMENT_SORT: AnnouncementSort = { columnId: "released", direction: "desc" };

const HEADLINE_MIN_WIDTH = 18;

const ALL_COLUMNS: readonly AnnouncementColumn[] = [
  { id: "released", label: "Sydney", width: 12, align: "left" },
  { id: "code", label: "Code", width: 6, align: "left" },
  // ASX marks price-sensitive releases with an asterisk; the column keeps it.
  { id: "sensitive", label: "PS", width: 4, align: "left" },
  { id: "type", label: "Type", width: 11, align: "left" },
  { id: "headline", label: "Headline", width: HEADLINE_MIN_WIDTH, align: "left", flexGrow: 1 },
  { id: "pages", label: "Pp", width: 4, align: "right" },
];

/** A narrow pane gives up page counts, then the type (the headline says it). */
const NARROW_DROP_ORDER: readonly AnnouncementColumnId[] = ["pages", "type"];

function tableWidth(columns: readonly AnnouncementColumn[]): number {
  return columns.reduce((total, column) => total + column.width + 1, 3);
}

export function buildAnnouncementColumns(width: number, options: { showCode: boolean; showPages: boolean }): AnnouncementColumn[] {
  let columns = ALL_COLUMNS.filter((column) => (column.id !== "code" || options.showCode)
    && (column.id !== "pages" || options.showPages));
  for (const id of NARROW_DROP_ORDER) {
    if (tableWidth(columns) <= width) break;
    columns = columns.filter((column) => column.id !== id);
  }
  const spare = Math.max(0, width - tableWidth(columns));
  return columns.map((column) => (column.id === "headline" ? { ...column, width: HEADLINE_MIN_WIDTH + spare } : { ...column }));
}

function sortValue(columnId: AnnouncementColumnId, row: AsxAnnouncement): string | number | null {
  switch (columnId) {
    case "released": return row.releasedAt;
    case "code": return row.code;
    case "sensitive": return row.priceSensitive ? 1 : 0;
    case "type": return CATEGORY_SHORT[row.category] || null;
    case "headline": return row.headline;
    case "pages": return row.pages;
  }
}

export function sortAnnouncements(rows: readonly AsxAnnouncement[], sort: AnnouncementSort): AsxAnnouncement[] {
  const columnId = sort.columnId ?? "released";
  return [...rows].sort((a, b) => (
    compareSortValues(sortValue(columnId, a), sortValue(columnId, b), sort.direction) || b.releasedAt - a.releasedAt
  ));
}

/** A header click sorts by that column, or flips it; dates and flags start descending. */
export function nextAnnouncementSort(current: AnnouncementSort, columnId: string): AnnouncementSort {
  const id = columnId as AnnouncementColumnId;
  if (current.columnId === id) return { columnId: id, direction: current.direction === "asc" ? "desc" : "asc" };
  return { columnId: id, direction: id === "released" || id === "sensitive" || id === "pages" ? "desc" : "asc" };
}

export function renderAnnouncementCell(row: AsxAnnouncement, column: AnnouncementColumn, now: number): DataTableCell {
  switch (column.id) {
    case "released":
      return { text: formatReleased(row.releasedAt, now), value: new Date(row.releasedAt), color: colors.textMuted };
    case "code":
      return { text: row.code, color: colors.textBright, attributes: TextAttributes.BOLD };
    case "sensitive":
      return row.priceSensitive
        ? { text: "*", value: "yes", color: colors.warning, attributes: TextAttributes.BOLD }
        : { text: "", value: null };
    case "type":
      return { text: CATEGORY_SHORT[row.category], color: colors.textDim };
    case "headline":
      return {
        text: row.headline,
        color: row.priceSensitive ? colors.textBright : colors.text,
      };
    case "pages":
      return { text: row.pages == null ? "" : String(row.pages), value: row.pages, color: colors.textMuted };
  }
}
