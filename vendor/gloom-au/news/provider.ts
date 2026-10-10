import { newsProvider } from "gloomberb/capabilities";
import { publicTickerKey, withDeadline } from "gloomberb/utils";
import { loadMarketAnnouncements } from "../announcements/client";
import { companyAnnouncementsPageUrl } from "../announcements/model";
import { loadAsxDirectory } from "../directory/client";
import { buildIssuerIndex, matchIssuer } from "../tenders/model";
import { createMemoryCache, fetchText } from "../shared/http";
import { ASIC_MEDIA_RELEASES_URL, parseAsicMediaReleases } from "./asic";
import { parseFeed, type FeedItem } from "./rss";

// The news types are not exported to plugins; take them from the factory.
type NewsSource = Parameters<typeof newsProvider>[0]["provider"];
type NewsQuery = Parameters<NewsSource["fetchNews"]>[0];
type NewsArticle = Awaited<ReturnType<NewsSource["fetchNews"]>>[number];

interface Feed {
  /** The publisher readers see. */
  source: string;
  url: string;
  importance: number;
  topic: string;
  /** Takeovers Panel titles lead with the target company ("Zenith Minerals Limited 05 – Panel Receives Application"). */
  tickersFromTitle?: boolean;
  /** Bodies that are not RSS. */
  parse?: (body: string) => FeedItem[];
}

const FEEDS: readonly Feed[] = [
  { source: "ABC News", url: "https://www.abc.net.au/news/feed/51892/rss.xml", importance: 40, topic: "business" },
  { source: "RBA", url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml", importance: 75, topic: "central-banks" },
  { source: "Takeovers Panel", url: "https://takeovers.gov.au/rss.xml", importance: 65, topic: "mergers-acquisitions", tickersFromTitle: true },
  { source: "TGA", url: "https://www.tga.gov.au/feeds/article/news.xml", importance: 35, topic: "healthcare" },
  { source: "TGA", url: "https://www.tga.gov.au/feeds/alert/safety-alerts.xml", importance: 40, topic: "healthcare" },
  // Enforcement outcomes, bans and policy; names in headlines are rarely ASX issuers, so no ticker tags.
  { source: "ASIC", url: ASIC_MEDIA_RELEASES_URL, importance: 55, topic: "regulation", parse: parseAsicMediaReleases },
];

/** The company a Takeovers Panel item is about: the title up to its matter number or dash. */
export function panelCompany(title: string): string {
  return title.split(/\s+\d{2}\b|\s+[–-]\s+/)[0]!.trim();
}

/** Price-sensitive announcements from companies this large reach the general feed. */
const ANNOUNCEMENT_UNIVERSE = 300;

const feedCache = createMemoryCache<FeedItem[]>(5 * 60_000, 8);

/**
 * The news pane waits for every source before it shows the merged feed, so a
 * slow Australian host must not hold up everyone else's headlines.
 */
const SOURCE_DEADLINE_MS = 8_000;

/** Older items are archive, not news; the TGA feeds reach back months. */
const MAX_AGE_MS = 30 * 86_400_000;

function article(input: {
  id: string; title: string; url: string; source: string; publishedAt: Date; summary?: string;
  topic: string; categories?: string[]; tickers?: string[]; importance: number;
}): NewsArticle {
  return {
    id: input.id,
    title: input.title,
    url: input.url,
    source: input.source,
    publishedAt: input.publishedAt,
    ...(input.summary ? { summary: input.summary } : {}),
    topic: input.topic,
    topics: [input.topic],
    sectors: [],
    categories: input.categories ?? [],
    tickers: input.tickers ?? [],
    scores: { importance: input.importance, urgency: 0, marketImpact: input.importance, novelty: 50, confidence: 90 },
    isBreaking: false,
    isDeveloping: false,
    importance: input.importance,
  };
}

async function feedArticles(feed: Feed): Promise<NewsArticle[]> {
  const items = await feedCache.load(feed.url, async () => (feed.parse ?? parseFeed)(await fetchText(feed.url)));
  const issuers = feed.tickersFromTitle ? buildIssuerIndex(await loadAsxDirectory().catch(() => [])) : null;
  const cutoff = Date.now() - MAX_AGE_MS;
  // An item dated ahead (an embargoed release) waits for its time; a few minutes allow for clock skew.
  const latest = Date.now() + 5 * 60_000;
  return items.filter((item) => item.publishedAt.getTime() >= cutoff && item.publishedAt.getTime() <= latest).map((item) => {
    const code = issuers ? matchIssuer(issuers, panelCompany(item.title)) : null;
    return article({
    id: `au:${feed.source}:${item.url}`,
    title: item.title,
    url: item.url,
    source: feed.source,
    publishedAt: item.publishedAt,
    summary: item.summary,
    topic: feed.topic,
    categories: item.categories,
    tickers: code ? [publicTickerKey(code, "ASX")] : [],
    importance: feed.importance,
  });
  });
}

async function announcementArticles(): Promise<NewsArticle[]> {
  const [announcements, directory] = await Promise.all([
    loadMarketAnnouncements({ priceSensitiveOnly: true, limit: 200 }),
    loadAsxDirectory().catch(() => []),
  ]);
  const ranked = [...directory].filter((company) => company.marketCap != null).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const large = new Map(ranked.slice(0, ANNOUNCEMENT_UNIVERSE).map((company) => [company.code, company.name]));
  return announcements
    .filter((announcement) => large.has(announcement.code))
    .map((announcement) => article({
      id: `au:asx:${announcement.id}`,
      title: `${announcement.code}: ${announcement.headline}`,
      url: companyAnnouncementsPageUrl(announcement.code),
      source: "ASX",
      publishedAt: new Date(announcement.releasedAt),
      summary: large.get(announcement.code),
      topic: "company-announcements",
      tickers: [publicTickerKey(announcement.code, "ASX")],
      importance: 60,
    }));
}

const SOURCE_NAMES = ["ABC News", "RBA", "ASX", "Takeovers Panel", "TGA", "ASIC"];

function wanted(query: NewsQuery, source: string): boolean {
  const lower = source.toLowerCase();
  if (query.sources?.length && !query.sources.some((name) => name.toLowerCase() === lower)) return false;
  if (query.excludeSources?.some((name) => name.toLowerCase() === lower)) return false;
  return true;
}

/** Australian business news, RBA and ASIC media releases, Takeovers Panel and TGA notices, and large companies' price-sensitive ASX announcements in the general feeds. */
export function createAuNewsCapability() {
  return newsProvider({
    id: "au-markets-news",
    name: "Australian news",
    priority: 200,
    provider: {
      // Ticker news comes from Gloom Cloud (and the Announcements tab); filtered feeds need tagging these sources lack.
      supports: (query) => {
        const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
        return (feed === "latest" || feed === "top")
          && !query.ticker && !query.topics?.length && !query.sectors?.length && !query.categories?.length
          && !query.sentiment && !query.breaking
          && SOURCE_NAMES.some((source) => wanted(query, source));
      },
      async fetchNews(query) {
        const tasks: Array<Promise<NewsArticle[]>> = [
          ...FEEDS.filter((feed) => wanted(query, feed.source))
            .map((feed) => withDeadline(feedArticles(feed), SOURCE_DEADLINE_MS, `${feed.source} feed timed out`)),
          ...(wanted(query, "ASX") ? [withDeadline(announcementArticles(), SOURCE_DEADLINE_MS, "ASX announcements timed out")] : []),
        ];
        const settled = await Promise.allSettled(tasks);
        const articles = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
        if (articles.length === 0 && settled.length > 0 && settled.every((result) => result.status === "rejected")) {
          throw (settled[0] as PromiseRejectedResult).reason;
        }
        const minImportance = query.minImportance ?? 0;
        return articles
          .filter((item) => item.importance >= minImportance
            && (!query.since || item.publishedAt >= query.since)
            && (!query.until || item.publishedAt <= query.until))
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
          .slice(0, query.limit ?? 100);
      },
    },
  });
}
