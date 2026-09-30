import type { GloomPluginContext } from "gloomberb/types/plugin";
import { isSectionId, type Headline } from "./types";

/**
 * `watchNewsQuery` lives on the plugin context, which a pane component is not
 * handed, so `setup` parks it here for the pane to pick up. It stays optional
 * on the context, so every read has to cope with it being absent.
 */
let pluginContext: GloomPluginContext | null = null;

export function setPluginContext(ctx: GloomPluginContext | null): void {
  pluginContext = ctx;
}

export function gloomNewsAvailable(): boolean {
  return typeof pluginContext?.watchNewsQuery === "function";
}

/** The slice of NewsArticle this plugin reads. The host type is not exported. */
interface HostNewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date | string | number;
  topic?: string;
  topics?: string[];
  categories?: string[];
  sourceCount?: number;
  scores?: { importance?: number };
  importance?: number;
}

interface HostNewsQueryState {
  phase: "idle" | "loading" | "ready" | "refreshing" | "error";
  articles: HostNewsArticle[];
  error: string | null;
  updatedAt: number | null;
}

export interface GloomNewsSnapshot {
  headlines: Headline[];
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}

function timestamp(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * The group a market story is coloured by. Gloomberb tags articles with its
 * own topics rather than Newsmap sections, so a recognised section wins and
 * anything else keeps its own name — `assignHues` gives it a colour and the
 * legend lists it.
 */
function groupOf(article: HostNewsArticle): string {
  const candidate = article.topic ?? article.topics?.[0] ?? article.categories?.[0];
  if (!candidate) return "BUSINESS";
  const upper = candidate.toUpperCase();
  return isSectionId(upper) ? upper : candidate;
}

export function toHeadlines(articles: HostNewsArticle[]): Headline[] {
  return articles.map((article, rank) => ({
    id: `gloom:${article.id}`,
    title: article.title,
    url: article.url,
    source: article.source,
    publishedAt: timestamp(article.publishedAt),
    section: groupOf(article),
    rank,
    // Gloomberb clusters by outlet count and does not cap it the way Google
    // does; the weighting caps it instead, so both sources size alike.
    // Coerced, not just defaulted: a non-numeric sourceCount would otherwise
    // carry NaN into the tile weight and blank the board.
    relatedCount: Number.isFinite(article.sourceCount) ? Math.max(0, article.sourceCount! - 1) : 0,
  }));
}

/**
 * Subscribes to the host's own top-stories feed. Returns a no-op unsubscribe
 * when the host is too old to offer `watchNewsQuery`, and reports that through
 * an error rather than an empty board.
 */
export function watchGloomNews(
  limit: number,
  listener: (snapshot: GloomNewsSnapshot) => void,
): () => void {
  const watch = pluginContext?.watchNewsQuery;
  if (!watch || !pluginContext) {
    listener({
      headlines: [],
      loading: false,
      error: "This Gloomberb build does not expose a news feed to plugins.",
      updatedAt: null,
    });
    return () => {};
  }

  // Its own stopped flag rather than trusting the host's disposer to be the
  // last word, and a callable check because a snapshot that returns nothing
  // would otherwise throw out of React's cleanup on unmount.
  let stopped = false;
  const dispose = watch.call(pluginContext, { feed: "top", limit }, (state: HostNewsQueryState) => {
    if (stopped) return;
    listener({
      headlines: toHeadlines(state.articles ?? []),
      loading: state.phase === "loading" || state.phase === "refreshing",
      error: state.error ?? null,
      updatedAt: state.updatedAt ?? null,
    });
  });

  return () => {
    stopped = true;
    if (typeof dispose === "function") dispose();
  };
}
