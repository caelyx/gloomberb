import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmptyState, FeedDataTableStackView, Spinner, StatGrid, openUrl, usePaneStatusLinkFooter, useTableLoadMore,
  type StatItem,
} from "gloomberb/components";
import {
  useAsyncResource, useAutoRefresh, useDebouncedPluginPaneState, usePaneTickerIdentity, usePluginPaneState,
  useShortcut, useUpdatedAgo,
} from "gloomberb/react";
import type { ScrollBoxRenderable } from "gloomberb/ui";
import { isPlainKey } from "gloomberb/utils";
import { announcementsCacheKey } from "../asx/cache";
import type { AnnouncementsPage, AsxAnnouncement } from "../asx/model";
import { toExtractUnavailable } from "../asx/extract-error";
import type { AsxAnnouncementsService } from "../asx/service";
import { asxCodeForTicker } from "../asx/ticker";
import { asxAnnouncementsPageUrl } from "../asx/urls";
import { filterAnnouncements, headerStats, notAsxMessage, toFeedItems, type ExtractState } from "./view-model";

export const ASX_REGISTRATION_ID = "asx-announcements";

export interface AsxAnnouncementsViewProps {
  width: number;
  height: number;
  focused: boolean;
  /** Null until the plugin's setup() has run. */
  service: AsxAnnouncementsService | null;
}

interface FirstPage {
  page: AnnouncementsPage;
  stale: boolean;
  refreshError?: string;
}

function dedupe(items: AsxAnnouncement[]): AsxAnnouncement[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.documentKey) ? false : (seen.add(item.documentKey), true)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The announcements list with an inline detail. Shared by the Ticker Research
 * tab and the floating pane, both of which follow the pane's ticker.
 */
export function AsxAnnouncementsView({ width, height, focused, service }: AsxAnnouncementsViewProps) {
  const { ticker } = usePaneTickerIdentity();
  const code = asxCodeForTicker(ticker);
  const scope = code ?? "none";

  // Cursor and open row are pane state so a relaunch or a shared pane restores them.
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>(`selectedIdx:${scope}`, 0);
  const [openItemId, setOpenItemIdState] = useDebouncedPluginPaneState<string | null>(`open:${scope}`, null);
  const setOpenItemId = useCallback(
    (itemId: string | null) => setOpenItemIdState(itemId, { immediate: true }),
    [setOpenItemIdState],
  );
  const [sensitiveOnly, setSensitiveOnly] = usePluginPaneState<boolean>("sensitiveOnly", false);

  // First page: cache-first through the service, so auto-refresh only reaches
  // the network once the plugin cache's TTL has passed.
  const loader = useMemo(() => {
    if (!service || !code) return null;
    return async (force: boolean): Promise<FirstPage> => {
      const result = await service.loadPage(code, 0, { force });
      return { page: result.data, stale: result.stale, refreshError: result.refreshError };
    };
  }, [service, code]);
  const initialData = useCallback((): FirstPage | null => {
    if (!service || !code) return null;
    const key = announcementsCacheKey(code, 0, service.client.itemsPerPage);
    const cached = service.caches.announcements.get(key, { allowExpired: true });
    return cached ? { page: cached.data, stale: true } : null;
  }, [service, code]);
  const first = useAsyncResource(loader, { initialData });
  useAutoRefresh(first.updatedAt, first.load);
  const updatedAgo = useUpdatedAgo(first.updatedAt);

  // Further pages append on scroll and are dropped when the ticker changes.
  const [extraPages, setExtraPages] = useState<AnnouncementsPage[]>([]);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  useEffect(() => {
    setExtraPages([]);
    setMoreError(null);
    loadingMoreRef.current = false;
  }, [code]);
  const lastPage = extraPages[extraPages.length - 1] ?? first.data?.page ?? null;
  const hasMore = !!lastPage?.hasMore && !moreError;
  const loadMore = useCallback(() => {
    if (!service || !code || !lastPage?.hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const nextPage = lastPage.page + 1;
    void service.loadPage(code, nextPage)
      .then((result) => {
        setExtraPages((current) => current.some((page) => page.page === result.data.page) ? current : [...current, result.data]);
      })
      .catch((error: unknown) => setMoreError(errorMessage(error)))
      .finally(() => { loadingMoreRef.current = false; });
  }, [service, code, lastPage]);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const onBodyScrollActivity = useTableLoadMore(scrollRef, hasMore, loadMore);

  const all = useMemo(
    () => dedupe([...(first.data?.page.items ?? []), ...extraPages.flatMap((page) => page.items)]),
    [first.data, extraPages],
  );
  const visible = useMemo(() => filterAnnouncements(all, { sensitiveOnly }), [all, sensitiveOnly]);

  useEffect(() => {
    if (visible.length > 0 && selectedIdx >= visible.length) setSelectedIdx(Math.max(0, visible.length - 1));
  }, [selectedIdx, setSelectedIdx, visible.length]);

  // The PDF is fetched only for the row the user opened, once per document.
  const openItem = openItemId ? all.find((item) => item.documentKey === openItemId) ?? null : null;
  const [extracts, setExtracts] = useState<ReadonlyMap<string, ExtractState>>(() => new Map());
  const [retryToken, setRetryToken] = useState(0);
  const requestedRef = useRef(new Set<string>());
  // A new service (after setup, say with an access token added) gets a fresh try at every document.
  useEffect(() => {
    requestedRef.current.clear();
    setExtracts(new Map());
  }, [service]);
  useEffect(() => {
    if (!service || !openItem) return;
    const key = openItem.documentKey;
    if (requestedRef.current.has(key)) return;
    requestedRef.current.add(key);
    setExtracts((current) => new Map(current).set(key, { status: "loading" }));
    void service.loadExtract(openItem)
      .then((result) => {
        setExtracts((current) => new Map(current).set(key, {
          status: "ready", text: result.data.text, totalPages: result.data.totalPages, pagesRead: result.data.pagesRead,
        }));
      })
      .catch((error: unknown) => {
        const failure = toExtractUnavailable(error);
        // Only a transient failure is fetched again on reopening; r retries any failure.
        if (failure.transient) requestedRef.current.delete(key);
        setExtracts((current) => new Map(current).set(key, { status: "error", message: failure.message }));
      });
  }, [service, openItem, retryToken]);

  const refresh = useCallback(() => {
    setMoreError(null);
    setExtraPages([]);
    if (openItem && extracts.get(openItem.documentKey)?.status === "error") {
      requestedRef.current.delete(openItem.documentKey);
      setRetryToken((token) => token + 1);
    }
    void first.reload();
  }, [first, openItem, extracts]);
  const toggleSensitive = useCallback(() => {
    setSensitiveOnly((current) => !current);
    setSelectedIdx(0);
  }, [setSensitiveOnly, setSelectedIdx]);
  const openWeb = useCallback(() => {
    if (code) openUrl(asxAnnouncementsPageUrl(code));
  }, [code]);

  useShortcut((event) => {
    if (event.targetEditable) return;
    if (isPlainKey(event, "r")) refresh();
    else if (isPlainKey(event, "s")) toggleSensitive();
    else if (isPlainKey(event, "w")) openWeb();
  }, { enabled: focused, scope: ASX_REGISTRATION_ID });

  const activeItem = openItem ?? visible[selectedIdx] ?? null;
  const stale = first.data?.stale ?? false;
  const error = first.error ?? first.data?.refreshError ?? moreError ?? null;
  // The footer owns the `o` (open PDF) hint and key.
  usePaneStatusLinkFooter({
    registrationId: ASX_REGISTRATION_ID,
    focused,
    url: activeItem?.pdfUrl ?? null,
    source: "ASX",
    label: "PDF",
    loading: first.loading,
    error,
    info: [
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
      // gloomberb 0.15.2's footer has no `stale` option yet, so say it here.
      ...(stale ? [{ id: "stale", parts: [{ text: "showing cached data", tone: "warning" as const }] }] : []),
      ...(sensitiveOnly ? [{ id: "filter", parts: [{ text: "price-sensitive only", tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      { id: "sensitive", key: "s", label: "ensitive only", title: "Toggle price-sensitive only", onPress: toggleSensitive },
      ...(code ? [{ id: "web", key: "w", label: "eb page", title: "Open announcements on asx.com.au", onPress: openWeb }] : []),
    ],
    showOpenHint: !!activeItem?.pdfUrl,
  });

  const stats = useMemo<StatItem[]>(() => (code
    ? headerStats(all, { code, totalItems: lastPage?.totalItems ?? null, hasMore, fallbackName: ticker?.metadata.name ?? null })
    : []), [all, code, hasMore, lastPage?.totalItems, ticker?.metadata.name]);

  if (!ticker) {
    return <EmptyState title="No ticker selected." message="Select an ASX-listed ticker to see its announcements." />;
  }
  if (!code) {
    return (
      <EmptyState
        title="Not an ASX listing."
        message={notAsxMessage(ticker.metadata.ticker)}
      />
    );
  }
  if (!service) {
    return <EmptyState title="ASX announcements is not ready." message="The plugin has not finished setting up." status="error" />;
  }
  if (first.loading && all.length === 0) return <Spinner label={`Loading ASX announcements for ${code}...`} />;
  if (first.error && all.length === 0) {
    return <EmptyState title="ASX announcements unavailable." message={first.error} hint="Press r to retry." status="error" />;
  }
  if (all.length === 0) return <EmptyState title={`No announcements for ${code}.`} />;

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={toFeedItems(visible, { code, openId: openItemId, extracts })}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      rootBefore={<StatGrid items={stats} width={width} />}
      sourceLabel="Type"
      titleLabel="Announcement"
      emptyStateTitle={sensitiveOnly ? `No price-sensitive announcements for ${code}.` : `No announcements for ${code}.`}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
