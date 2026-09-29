import { newsProvider } from "gloomberb/capabilities";
import { cachedFeed, loadFeed } from "./cache";
import { configuredEditionId, configuredProviderSections } from "./config";
import { freshness, storyWeight } from "./model";
import {
  DEFAULT_SECTIONS, GOOGLE_NEWS_SOURCE_ID, isSectionId, sectionLabel, type Headline,
} from "./types";

/**
 * Alongside Yahoo (1000) and the RSS wire (2000) rather than just behind the
 * first-party cloud feed: this is a community scrape of a public RSS feed, and
 * ranking it above the host's own sources would be a claim it cannot support.
 */
const PRIORITY = 1500;
const DEFAULT_LIMIT = 60;
const MAX_CLUSTER = 5;

/** The slice of NewsQuery this provider reads. The host type is not exported. */
interface NewsQueryLike {
  feed?: string;
  ticker?: string;
  topics?: string[];
  categories?: string[];
  breaking?: boolean;
  limit?: number;
}

/**
 * Only the feeds this provider can actually answer.
 *
 * Google News has no symbol search worth the name, so ticker feeds are left to
 * the providers that do. `breaking` is declined outright: RSS carries no signal
 * for it, every article here is `isBreaking: false`, and the host filters on
 * that — so claiming it would mean spending four HTTP round-trips to return
 * nothing, every time.
 */
function supports(query: NewsQueryLike): boolean {
  if (query.ticker || query.feed === "ticker" || query.feed === "sector") return false;
  if (query.breaking === true || query.feed === "breaking") return false;
  return true;
}

/**
 * Topics are matched against both the section id and its label, because the
 * articles this provider emits are tagged with the label ("Business") while the
 * feed is addressed by id ("BUSINESS") — a query echoing an article's own topic
 * back has to resolve.
 */
function sectionsFor(query: NewsQueryLike): string[] {
  const byLabel = new Map(
    DEFAULT_SECTIONS.concat(["TOP", "ENTERTAINMENT", "SPORTS"] as never)
      .map((id) => [sectionLabel(id).toLowerCase(), id as string]),
  );
  const asked = [...(query.topics ?? []), ...(query.categories ?? [])]
    .map((topic) => (isSectionId(topic.toUpperCase()) ? topic.toUpperCase() : byLabel.get(topic.toLowerCase())))
    .filter((id): id is string => !!id);
  // A query that names its sections gets them, whatever the scope: the scope
  // is a default for the feeds that ask for "the news", not a filter on what
  // the provider is willing to serve.
  return asked.length > 0 ? [...new Set(asked)] : [...configuredProviderSections()];
}

/**
 * The heaviest story this weighting can produce: rank 0 carried by the most
 * outlets Google will list. Importance is reported against this fixed ceiling
 * rather than against the batch, so a quiet day scores lower than a busy one
 * instead of every batch renormalising to 1.
 */
const MAX_WEIGHT = storyWeight({ rank: 0, relatedCount: MAX_CLUSTER } as Headline);

function toArticles(headlines: readonly Headline[], limit: number, now: number) {
  return [...headlines]
    .sort((a, b) => storyWeight(b) - storyWeight(a))
    .slice(0, limit)
    .map((headline) => {
      const importance = Math.min(1, storyWeight(headline) / MAX_WEIGHT);
      const cluster = Math.min(headline.relatedCount, MAX_CLUSTER) / MAX_CLUSTER;
      return {
        id: headline.id,
        title: headline.title,
        url: headline.url,
        source: headline.source,
        publishedAt: new Date(headline.publishedAt),
        topic: sectionLabel(headline.section),
        topics: [sectionLabel(headline.section)],
        sectors: [],
        categories: [headline.section],
        tickers: [],
        scores: {
          importance,
          // Recency, which the feed does report — not a second copy of
          // importance, which would make `minUrgency` silently filter on the
          // wrong thing.
          urgency: freshness(headline.publishedAt, now),
          // Google News RSS says nothing about markets. Zero is the honest
          // floor here, not a measurement.
          marketImpact: 0,
          // A story one outlet is running is new; one that twenty are running
          // is not. Both of these are derived from the cluster, not invented.
          novelty: 1 - cluster,
          confidence: 0.3 + 0.7 * cluster,
        },
        isBreaking: false,
        isDeveloping: headline.relatedCount >= MAX_CLUSTER - 1,
        sourceCount: headline.relatedCount + 1,
        importance,
      };
    });
}

function resolveLimit(limit: number | undefined): number {
  return Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : DEFAULT_LIMIT;
}

export const googleNewsCapability = newsProvider({
  id: GOOGLE_NEWS_SOURCE_ID,
  name: "Google News",
  priority: PRIORITY,
  provider: {
    supports,
    /**
     * Lets the host paint its news pane from the last board before any network
     * happens; `load` below refreshes it.
     */
    getCachedNews: (query: NewsQueryLike) => {
      const cached = cachedFeed(sectionsFor(query), configuredEditionId());
      return cached ? toArticles(cached.headlines, resolveLimit(query.limit), Date.now()) : [];
    },
    fetchNews: async (query: NewsQueryLike) => {
      // Through the shared cache: the host polls every tracked query every two
      // minutes, so an uncached provider would fetch four RSS feeds a minute
      // for as long as the app is open.
      const feed = await loadFeed(sectionsFor(query), configuredEditionId());
      return toArticles(feed.headlines, resolveLimit(query.limit), Date.now());
    },
  },
});
