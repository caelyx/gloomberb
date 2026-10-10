import { createPluginCache, decodeHtmlEntities, httpFetch } from "gloomberb/utils";
import type { GloomPluginContext } from "gloomberb/types/plugin";
import { ABC_FEED_URL, isYoutubeVideoId, watchUrl } from "./channel";
import type { AbcStory } from "./types";

/**
 * The channel's Atom feed: exact times and story text for the latest fifteen
 * uploads. Kept apart from `youtube.ts` so the browser entry can read it
 * without pulling in youtubei.js.
 */

const FETCH_TIMEOUT_MS = 10_000;
/** Uploads land every few minutes on a news day; the pane refreshes on the same cadence. */
const STALE_MS = 5 * 60 * 1000;
/** Kept well past stale so a failed refresh still draws the last good list. */
const EXPIRE_MS = 24 * 60 * 60 * 1000;

export interface StoriesStore {
  attach(persistence: GloomPluginContext["persistence"]): void;
  reset(): void;
  load(options?: { force?: boolean }): Promise<AbcStory[]>;
}

/** The story list, cached across restarts so the pane opens on the last good list. */
export function createStoriesStore(
  options: { kind: string; schemaVersion: number },
  fetchStories: () => Promise<AbcStory[]>,
): StoriesStore {
  const cache = createPluginCache<AbcStory[]>({
    kind: options.kind,
    source: "youtube-feed",
    schemaVersion: options.schemaVersion,
    policy: { staleMs: STALE_MS, expireMs: EXPIRE_MS },
  });
  return {
    attach: (persistence) => cache.attach(persistence),
    reset: () => cache.reset(),
    load: async (loadOptions) => (await cache.load("latest", fetchStories, { force: loadOptions?.force === true })).data,
  };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Through `httpFetch` by default: a plain request in the terminal and the
 * desktop's native process, and the worker's proxy on the web, where the
 * feed sends no CORS headers.
 */
export async function fetchFeed(fetch: FetchLike = httpFetch): Promise<AbcStory[]> {
  const response = await fetch(ABC_FEED_URL, {
    headers: { Accept: "application/atom+xml, application/xml;q=0.9" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ABC News stories failed to load (HTTP ${response.status}).`);
  return parseStoriesFeed(await response.text());
}

/** Every upload title ends with the channel's own tag, which the pane already names. */
const CHANNEL_TAG = /\s*\|\s*ABC NEWS\s*$/i;

export function cleanTitle(title: string): string {
  return title.replace(CHANNEL_TAG, "").trim();
}

function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? decodeHtmlEntities(match[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim() : undefined;
}

function tagAttribute(xml: string, tag: string, attribute: string): string | undefined {
  const element = xml.match(new RegExp(`<${tag}\\s[^>]*>`))?.[0];
  const value = element?.match(new RegExp(`\\s${attribute}="([^"]*)"`))?.[1];
  return value ? decodeHtmlEntities(value) : undefined;
}

/** Where the story text ends and the channel's sign-off begins. */
const BOILERPLATE_LINE = /^(subscribe|read more|watch more|note:|#)|https?:\/\//i;

/**
 * A description is the story in a sentence or two, then subscribe links,
 * a captions note and hashtags. Only the story part is worth showing.
 */
export function storySummary(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const lines: string[] = [];
  for (const line of description.split("\n").map((item) => item.trim())) {
    if (BOILERPLATE_LINE.test(line)) break;
    if (line) lines.push(line);
  }
  return lines.join(" ") || undefined;
}

/**
 * The channel's Atom feed: the latest fifteen uploads, newest first. Only
 * `<entry>` blocks are read, so the feed's own title never becomes a story.
 */
export function parseStoriesFeed(xml: string): AbcStory[] {
  const stories: AbcStory[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = tagText(entry!, "yt:videoId");
    const title = cleanTitle(tagText(entry!, "title") ?? "");
    const publishedAt = Date.parse(tagText(entry!, "published") ?? "");
    if (!isYoutubeVideoId(id) || !title || !Number.isFinite(publishedAt)) continue;
    const link = tagAttribute(entry!, "link", "href");
    stories.push({
      id,
      title,
      publishedAt,
      // Shorts link to /shorts/, which is where the browser should take them.
      watchUrl: link?.startsWith("https://www.youtube.com/") ? link : watchUrl(id),
      thumbnailUrl: tagAttribute(entry!, "media:thumbnail", "url"),
      summary: storySummary(tagText(entry!, "media:description")),
    });
  }
  return stories;
}
