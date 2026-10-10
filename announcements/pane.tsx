import { useCallback, useMemo } from "react";
import { usePaneNoticeFooter, usePaneStatusLinkFooter, usePaneTabs } from "gloomberb/components";
import {
  useAutoRefresh,
  usePaneTickerIdentity,
  usePluginPaneState,
  usePluginTickerActions,
} from "gloomberb/react";
import { TICKER_RESEARCH_PANE_ID } from "gloomberb/types/config";
import type { PaneProps } from "gloomberb/types/plugin";
import { asxCodeForTicker } from "../shared/asx";
import { useCacheStatus, useKeyedCachedResource } from "../shared/cache-status";
import { cachedMarketFeed, loadMarketFeed } from "./client";
import { CompanyAnnouncements } from "./company-view";
import {
  companyAnnouncementsPageUrl,
  filterAnnouncements,
  type AnnouncementFilter,
  type AsxAnnouncement,
} from "./model";
import { AnnouncementsTable } from "./view";

// Not "asx-announcements": the separate gloom-asx plugin already uses that id.
export const ANNOUNCEMENTS_PANE_ID = "au-announcements";
export const ANNOUNCEMENTS_TAB_ID = "au-announcements";

type MarketFilter = Extract<AnnouncementFilter, "all" | "sensitive" | "directors" | "substantial">;

const MARKET_TABS: Array<{ label: string; value: MarketFilter }> = [
  { label: "All", value: "all" },
  { label: "Price sensitive", value: "sensitive" },
  { label: "Directors", value: "directors" },
  { label: "Substantial", value: "substantial" },
];

/**
 * ASXA: the latest announcements across the market, or one company's when the
 * pane is bound to an ASX ticker (`ASXA BHP`).
 */
export function AnnouncementsPane({ paneId, focused, width, height }: PaneProps) {
  const { symbol, ticker } = usePaneTickerIdentity(paneId);
  const code = asxCodeForTicker(ticker, symbol);
  return code
    ? <CompanyAnnouncements key={code} code={code} fallbackName={ticker?.metadata.name || null} registrationId={ANNOUNCEMENTS_PANE_ID} focused={focused} width={width} height={height} />
    : <MarketAnnouncementsView focused={focused} width={width} height={height} />;
}

/** Price-sensitive is a server-side filter, so it gets its own 500 rows instead of a slice of the latest. */
function marketQuery(key: "all" | "sensitive") {
  return { priceSensitiveOnly: key === "sensitive", limit: 500 };
}

function MarketAnnouncementsView({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const { pinTicker } = usePluginTickerActions();
  const [filter, setFilter] = usePluginPaneState<MarketFilter>("marketFilter", "all");
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("marketSelectedId", null);
  const sensitive = filter === "sensitive";
  // The last list on disk paints at once, also on toggling the filter; the load refreshes it once stale.
  const { data: feed, loading, error, updatedAt, load, reload } = useKeyedCachedResource(
    sensitive ? "sensitive" : "all",
    (key, force) => loadMarketFeed(marketQuery(key), { force }),
    (key) => cachedMarketFeed(marketQuery(key)),
  );
  useAutoRefresh(updatedAt, load);
  const cacheStatus = useCacheStatus(feed, loading);
  const data = feed?.data ?? null;
  const rows = useMemo(() => (data ? filterAnnouncements(data, filter) : null), [data, filter]);
  const selected = rows?.find((row) => row.id === selectedId) ?? null;

  const tabs = usePaneTabs({
    tabs: MARKET_TABS,
    activeValue: filter,
    onSelect: (value) => setFilter(value as MarketFilter),
    focused,
  });

  usePaneStatusLinkFooter({
    registrationId: ANNOUNCEMENTS_PANE_ID,
    focused,
    url: selected ? selected.documentUrl ?? companyAnnouncementsPageUrl(selected.code) : null,
    loading: loading && !!data,
    error: data ? error : null,
    info: cacheStatus.info,
    stale: cacheStatus.stale,
  });
  usePaneNoticeFooter({ registrationId: `${ANNOUNCEMENTS_PANE_ID}:notices`, focused, notices: cacheStatus.notices });

  const openCompany = useCallback((row: AsxAnnouncement) => {
    pinTicker(`${row.code}.AX`, { floating: true, paneType: TICKER_RESEARCH_PANE_ID, tabId: ANNOUNCEMENTS_TAB_ID });
  }, [pinTicker]);

  return (
    <AnnouncementsTable
      rows={rows}
      loading={loading}
      error={error}
      focused={focused}
      width={width}
      height={height}
      showCode
      before={tabs.strip}
      beforeRows={tabs.rows}
      selectedId={selectedId}
      onSelectedIdChange={setSelectedId}
      onActivate={openCompany}
      onRefresh={reload}
      loadingLabel="Loading ASX announcements..."
      errorTitle="ASX announcements unavailable."
      emptyTitle={filter === "all" ? "No announcements in the feed." : "No recent announcements of this type."}
    />
  );
}
