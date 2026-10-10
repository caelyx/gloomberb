import { httpFetch } from "gloomberb/utils";
import type { AbcVideoServices } from "./capability";
import { createStoriesStore, fetchFeed, type FetchLike, type StoriesStore } from "./atom-feed";
import { ABC_CHANNEL_ID, ABC_LIVE_URL, watchUrl } from "./channel";
import type { ResolvedVideo } from "./types";

/**
 * The web app has no native process to run youtubei.js in, and a stream URL
 * resolved through its proxy would be tied to the proxy's address, not the
 * viewer's. So on the web both live and stories play in YouTube's own embed,
 * which YouTube accepts there because the page has a real origin (the
 * desktop's page has none: player error 153).
 */
const EMBED_BASE = "https://www.youtube.com/embed";
/**
 * Embed URLs do not expire; the web player does not renew them. This only
 * keeps `ResolvedVideo` honest for anything that checks it.
 */
const EMBED_VALID_MS = 24 * 60 * 60_000;

function embedUrl(path: string, params: Record<string, string> = {}): string {
  // enablejsapi lets the host's player drive play, pause and mute.
  return `${EMBED_BASE}/${path}?${new URLSearchParams({ autoplay: "1", enablejsapi: "1", ...params })}`;
}

export interface WebServices extends AbcVideoServices {
  attachStoriesCache: StoriesStore["attach"];
  resetStoriesCache: StoriesStore["reset"];
}

export function createWebServices(options: { fetch?: FetchLike; now?: () => number } = {}): WebServices {
  const now = options.now ?? Date.now;
  // Its own kind: the web list is the feed alone, fifteen deep, and must not
  // be read as the desktop's longer one.
  const store = createStoriesStore(
    { kind: "abcnews-web-stories", schemaVersion: 1 },
    () => fetchFeed(options.fetch ?? httpFetch),
  );

  function resolved(video: Pick<ResolvedVideo, "videoId" | "title" | "isLive" | "mediaUrl" | "watchUrl" | "posterUrl">): ResolvedVideo {
    const resolvedAt = now();
    return { ...video, resolvedAt, expiresAt: resolvedAt + EMBED_VALID_MS };
  }

  return {
    // YouTube's "whatever this channel is streaming now" embed, which follows
    // ABC's restarts of the stream without our looking up its video id.
    async live() {
      return resolved({
        videoId: "live",
        title: "ABC NEWS Live",
        isLive: true,
        mediaUrl: embedUrl("live_stream", { channel: ABC_CHANNEL_ID, mute: "1" }),
        watchUrl: ABC_LIVE_URL,
      });
    },
    async video(videoId) {
      return resolved({
        videoId,
        title: "ABC NEWS",
        isLive: false,
        mediaUrl: embedUrl(videoId),
        watchUrl: watchUrl(videoId),
        posterUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    },
    stories: store.load,
    attachStoriesCache: store.attach,
    resetStoriesCache: store.reset,
  };
}
