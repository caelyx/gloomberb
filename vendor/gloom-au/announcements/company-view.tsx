import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaneStatusBody,
  QueryBar,
  StatGrid,
  statGridRows,
  usePaneStatusLinkFooter,
  useTableLoadMore,
  type DataTableKeyEvent,
} from "gloomberb/components";
import { useAsyncResource, useAutoRefresh, usePluginPaneState } from "gloomberb/react";
import { Box, useRendererHost, type ScrollBoxRenderable } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { loadCompanyAnnouncements } from "./client";
import { cachedFirstPage, loadExtract, loadFeedPage } from "./company-feed";
import { headerStats, toFeedItems, type ExtractState } from "./company-model";
import { toExtractUnavailable } from "./extract/errors";
import { SydneyFeedStackView } from "./feed-view";
import type { FeedPage } from "./feed";
import { CATEGORY_LABELS, companyAnnouncementsPageUrl, filterAnnouncements, type AnnouncementCategory, type AnnouncementFilter, type AsxAnnouncement } from "./model";

const TYPE_OPTIONS: Array<{ value: AnnouncementFilter; label: string }> = [
  { value: "all", label: "All" },
  ...(Object.keys(CATEGORY_LABELS) as AnnouncementCategory[]).map((category) => ({ value: category as AnnouncementFilter, label: CATEGORY_LABELS[category] })),
];

/** With a filter on, pages load until it shows this many rows, or this many extra pages have loaded. */
const MIN_FILTERED_ROWS = 20;
const MAX_FILTER_PAGES = 10;

interface FirstPage {
  page: FeedPage;
  stale: boolean;
  refreshError?: string;
  /** The feed failed, so this is the asx.com.au company list: six months, no paging, no PDF extracts. */
  fallback?: boolean;
}

/** Cursor and open row, kept under one key so the saved layout does not grow with every ticker visited. */
interface Position {
  code: string;
  selectedIdx: number;
  openId: string | null;
}

function dedupe(items: AsxAnnouncement[]): AsxAnnouncement[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CompanyAnnouncementsProps {
  code: string;
  /** Gloomberb's name for the ticker, used until a row names the company. */
  fallbackName: string | null;
  registrationId: string;
  focused: boolean;
  width: number;
  height: number;
}

/**
 * One company's announcements, newest first, paged on scroll; Enter opens one
 * with an extract of its PDF. The Ticker Research tab and `ASXA <ticker>`.
 */
export function CompanyAnnouncements({ code, fallbackName, registrationId, focused, width, height }: CompanyAnnouncementsProps) {
  const rendererHost = useRendererHost();
  const [type, setType] = usePluginPaneState<AnnouncementFilter>("announcementsType", "all");
  const [sensitiveOnly, setSensitiveOnly] = usePluginPaneState<boolean>("announcementsSensitive", false);
  // A company's feed carries other issuers' notices about it; an ETF's carries its issuer's other funds.
  const [ownOnly, setOwnOnly] = usePluginPaneState<boolean>("announcementsOwnOnly", false);
  const [position, setPosition] = usePluginPaneState<Position | null>("announcementsPosition", null);
  const selectedIdx = position?.code === code ? position.selectedIdx : 0;
  const openId = position?.code === code ? position.openId : null;
  const setSelectedIdx = useCallback((index: number) => setPosition((current) => ({ code, selectedIdx: index, openId: current?.code === code ? current.openId : null })), [code, setPosition]);
  const setOpenId = useCallback((id: string | null) => setPosition((current) => ({ code, selectedIdx: current?.code === code ? current.selectedIdx : 0, openId: id })), [code, setPosition]);

  // First page: cache-first, so the list appears at once and auto-refresh reaches ASX only once it is stale.
  const loader = useCallback(async (force: boolean): Promise<FirstPage> => {
    try {
      const result = await loadFeedPage(code, 0, { force });
      return { page: result.data, stale: result.stale, refreshError: result.refreshError };
    } catch (error) {
      const items = await loadCompanyAnnouncements(code, "M6", { force }).catch(() => { throw error; });
      return { page: { items, page: 0, hasMore: false, totalItems: null }, stale: false, fallback: true };
    }
  }, [code]);
  const initialData = useCallback((): FirstPage | null => {
    const cached = cachedFirstPage(code);
    return cached ? { page: cached, stale: true } : null;
  }, [code]);
  const first = useAsyncResource(loader, { initialData });
  useAutoRefresh(first.updatedAt, first.load);

  // Further pages append on scroll.
  const [extraPages, setExtraPages] = useState<FeedPage[]>([]);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const lastPage = extraPages.at(-1) ?? first.data?.page ?? null;
  const hasMore = !!lastPage?.hasMore && !moreError && !first.data?.fallback;
  const loadMore = useCallback(() => {
    if (!lastPage?.hasMore || loadingMore.current) return;
    loadingMore.current = true;
    void loadFeedPage(code, lastPage.page + 1)
      .then((result) => setExtraPages((current) => (current.some((page) => page.page === result.data.page) ? current : [...current, result.data])))
      .catch((error: unknown) => setMoreError(message(error)))
      .finally(() => { loadingMore.current = false; });
  }, [code, lastPage]);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const onBodyScrollActivity = useTableLoadMore(scrollRef, hasMore, loadMore);

  const all = useMemo(() => dedupe([...(first.data?.page.items ?? []), ...extraPages.flatMap((page) => page.items)]), [first.data, extraPages]);
  const visible = useMemo(
    () => filterAnnouncements(all, type, sensitiveOnly).filter((item) => !ownOnly || item.code === code),
    [all, code, ownOnly, sensitiveOnly, type],
  );
  useEffect(() => {
    if (visible.length > 0 && selectedIdx >= visible.length) setSelectedIdx(visible.length - 1);
  }, [selectedIdx, setSelectedIdx, visible.length]);

  // A filter can leave too few rows to scroll, which is what loads more; fetch a few more pages for it.
  const filtering = type !== "all" || sensitiveOnly || ownOnly;
  useEffect(() => {
    if (filtering && hasMore && visible.length < MIN_FILTERED_ROWS && extraPages.length < MAX_FILTER_PAGES) loadMore();
  }, [extraPages.length, filtering, hasMore, loadMore, visible.length]);

  // The PDF is fetched only for the row the user opened, once per document.
  const openItem = openId ? all.find((item) => item.id === openId) ?? null : null;
  const [extracts, setExtracts] = useState<ReadonlyMap<string, ExtractState>>(() => new Map());
  const requested = useRef(new Set<string>());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!openItem?.documentKey || requested.current.has(openItem.id)) return;
    const id = openItem.id;
    requested.current.add(id);
    setExtracts((current) => new Map(current).set(id, { status: "loading" }));
    void loadExtract(openItem)
      .then((result) => setExtracts((current) => new Map(current).set(id, { status: "ready", ...result.data })))
      .catch((error: unknown) => {
        const failure = toExtractUnavailable(error);
        // A transient failure is fetched again on reopening; r retries any.
        if (failure.transient) requested.current.delete(id);
        setExtracts((current) => new Map(current).set(id, { status: "error", message: failure.message }));
      });
  }, [openItem, retry]);

  const refresh = useCallback(() => {
    setMoreError(null);
    setExtraPages([]);
    if (openItem && extracts.get(openItem.id)?.status === "error") {
      requested.current.delete(openItem.id);
      setRetry((value) => value + 1);
    }
    void first.reload();
  }, [extracts, first, openItem]);

  const handleKey = useCallback((event: DataTableKeyEvent): boolean => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    refresh();
    return true;
  }, [refresh]);

  const openWeb = useCallback(() => { void rendererHost.openExternal(companyAnnouncementsPageUrl(code)); }, [code, rendererHost]);
  const active = openItem ?? visible[selectedIdx] ?? null;
  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url: active?.documentUrl ?? null,
    label: active?.documentKey ? "PDF" : "link",
    showOpenHint: !!active?.documentUrl,
    loading: first.loading && !!first.data,
    error: first.data ? (first.error ?? first.data.refreshError ?? moreError) : null,
    stale: first.data?.stale ?? false,
    hints: [{ id: "web", key: "w", label: "eb page", title: "Open the announcements page on asx.com.au", onPress: openWeb }],
  });

  const stats = useMemo(() => headerStats(all, {
    code, totalItems: lastPage?.totalItems ?? null, hasMore, fallbackName,
  }), [all, code, fallbackName, hasMore, lastPage?.totalItems]);
  const items = useMemo(() => toFeedItems(visible, { code, openId, extracts }), [code, extracts, openId, visible]);

  const queryBar = (
    <QueryBar
      width={width}
      filters={[
        { id: "type", label: "Type", value: type, defaultValue: "all", options: TYPE_OPTIONS, onChange: (value: AnnouncementFilter) => setType(value) },
        { id: "sensitive", kind: "toggle", label: "Price sensitive", short: "PS", value: sensitiveOnly, defaultValue: false, onChange: setSensitiveOnly },
        { id: "own", kind: "toggle", label: `${code} only`, short: "Own", value: ownOnly, defaultValue: false, onChange: setOwnOnly },
      ]}
    />
  );

  if (!first.data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {queryBar}
        {first.loading || !first.error
          ? <PaneStatusBody loading align="center" loadingLabel={`Loading ${code} announcements...`} />
          : <PaneStatusBody error={first.error} errorTitle={`${code} announcements unavailable.`} />}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <SydneyFeedStackView
        width={width}
        height={height}
        focused={focused}
        items={items}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
        openItemId={openId}
        onOpenItemIdChange={setOpenId}
        rootBefore={(
          <Box flexDirection="column" height={1 + statGridRows(stats, width)}>
            {queryBar}
            <StatGrid items={stats} width={width} />
          </Box>
        )}
        onRootKeyDown={handleKey}
        sourceLabel="Type"
        titleLabel="Announcement"
        emptyStateTitle={!filtering ? `No announcements for ${code}.` : "No loaded announcements match these filters."}
        emptyStateHint={hasMore ? "Scroll to load older announcements." : undefined}
        scrollRef={scrollRef}
        onBodyScrollActivity={onBodyScrollActivity}
      />
    </Box>
  );
}
