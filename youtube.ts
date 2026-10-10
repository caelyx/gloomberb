import { withDeadline } from "gloomberb/utils";
import { ABC_CHANNEL_ID, watchUrl } from "./channel";
import type { ResolvedVideo } from "./types";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_LIVE_CANDIDATES = 6;
/** The one format that carries audio and video together, which mpv needs from a plain URL. */
const MUXED_360P_ITAG = 18;
const LIVE_KEY = "live";
/**
 * A lookup is several YouTube round trips. Without a limit a stalled one
 * would hold the pane on "resolving", and every later request that joins it,
 * for as long as the connection stays open.
 */
export const LOOKUP_TIMEOUT_MS = 20_000;
/** Upcoming premieres sit on the Videos tab before they can be played. */
const UPCOMING = /\b(premieres?|scheduled|waiting)\b/i;

type YoutubeModule = typeof import("youtubei.js");
type YoutubeClient = InstanceType<YoutubeModule["Innertube"]>;
type BasicInfo = Awaited<ReturnType<YoutubeClient["getBasicInfo"]>>;

let clientPromise: Promise<YoutubeClient> | null = null;
const videoCache = new Map<string, ResolvedVideo>();
const activeResolutions = new Map<string, Promise<ResolvedVideo>>();

async function getYoutubeClient(): Promise<{ client: YoutubeClient; module: YoutubeModule }> {
  const module = await import("youtubei.js");
  module.Log.setLevel(module.Log.Level.ERROR);
  clientPromise ??= module.Innertube.create({
    generate_session_locally: true,
    enable_session_cache: true,
  });
  return { client: await clientPromise, module };
}

function largestThumbnail(info: BasicInfo): string | undefined {
  const thumbnails = info.basic_info.thumbnail ?? [];
  return thumbnails.reduce<(typeof thumbnails)[number] | undefined>((best, item) => {
    if (!best) return item;
    return (item.width ?? 0) * (item.height ?? 0) > (best.width ?? 0) * (best.height ?? 0) ? item : best;
  }, undefined)?.url;
}

function toResolvedVideo(videoId: string, info: BasicInfo, mediaUrl: string, isLive: boolean): ResolvedVideo {
  const resolvedAt = Date.now();
  return {
    videoId,
    title: info.basic_info.title || (isLive ? "ABC NEWS Live" : "ABC NEWS"),
    isLive,
    mediaUrl,
    watchUrl: watchUrl(videoId),
    posterUrl: largestThumbnail(info),
    resolvedAt,
    expiresAt: info.streaming_data?.expires?.getTime() ?? resolvedAt + CACHE_TTL_MS,
  };
}

/**
 * The channel's live video id changes whenever ABC restarts the stream, so it
 * is found through the channel's live list each time rather than pinned.
 */
async function resolveLiveUncached(): Promise<ResolvedVideo> {
  const { client, module } = await getYoutubeClient();
  const channel = await client.getChannel(ABC_CHANNEL_ID);
  if (!channel.has_live_streams) throw new Error("ABC NEWS is not streaming live right now.");

  const liveFeed = await channel.getLiveStreams();
  const candidates = liveFeed.memo
    .getType(module.YTNodes.LockupView)
    .filter((item) => item.content_type === "VIDEO")
    .slice(0, MAX_LIVE_CANDIDATES);

  for (const candidate of candidates) {
    const info = await client.getBasicInfo(candidate.content_id, { client: "ANDROID" });
    const manifestUrl = info.streaming_data?.hls_manifest_url;
    if (info.basic_info.is_live && manifestUrl) return toResolvedVideo(candidate.content_id, info, manifestUrl, true);
  }
  throw new Error("ABC NEWS does not currently have a playable live stream.");
}

async function resolveVideoUncached(videoId: string): Promise<ResolvedVideo> {
  const { client } = await getYoutubeClient();
  const info = await client.getBasicInfo(videoId, { client: "ANDROID" });
  const format = info.streaming_data?.formats?.find((item) => item.itag === MUXED_360P_ITAG && item.url)
    ?? info.streaming_data?.formats?.find((item) => item.url);
  if (!format?.url) throw new Error("This story has no playable video.");
  return toResolvedVideo(videoId, info, format.url, false);
}

function usableCached(key: string): ResolvedVideo | null {
  const cached = videoCache.get(key);
  if (!cached) return null;
  const validUntil = Math.min(cached.resolvedAt + CACHE_TTL_MS, cached.expiresAt - 60_000);
  return Date.now() < validUntil ? cached : null;
}

/** Cached for ten minutes (or until the URL is about to expire), with concurrent requests sharing one lookup. */
function resolveCached(key: string, resolve: () => Promise<ResolvedVideo>, force: boolean): Promise<ResolvedVideo> {
  if (!force) {
    const cached = usableCached(key);
    if (cached) return Promise.resolve(cached);
    const active = activeResolutions.get(key);
    if (active) return active;
  }

  const resolution = withDeadline(resolve(), LOOKUP_TIMEOUT_MS, "YouTube did not answer in time.")
    .then((video) => {
      if (activeResolutions.get(key) === resolution) {
        // Every story opened adds an entry; drop the ones that can no longer play.
        for (const [cachedKey, cached] of videoCache) {
          if (cached.expiresAt <= Date.now()) videoCache.delete(cachedKey);
        }
        videoCache.set(key, video);
      }
      return video;
    })
    .finally(() => {
      if (activeResolutions.get(key) === resolution) activeResolutions.delete(key);
    });
  activeResolutions.set(key, resolution);
  return resolution;
}

export function resolveLive(options?: { force?: boolean }): Promise<ResolvedVideo> {
  return resolveCached(LIVE_KEY, resolveLiveUncached, options?.force === true);
}

export function resolveVideo(videoId: string, options?: { force?: boolean }): Promise<ResolvedVideo> {
  return resolveCached(videoId, () => resolveVideoUncached(videoId), options?.force === true);
}

export interface ChannelVideo {
  id: string;
  title: string;
  /** Only relative, such as "3 hours ago": the listing carries no timestamp. */
  publishedText?: string;
  thumbnailUrl?: string;
}

/**
 * The channel's Videos tab, newest first, thirty to a page. Shorts and live
 * streams have tabs of their own, so neither appears here.
 */
export async function listChannelVideos(limit: number): Promise<ChannelVideo[]> {
  const { client, module } = await getYoutubeClient();
  const channel = await client.getChannel(ABC_CHANNEL_ID);
  const videos: ChannelVideo[] = [];
  type Page = Awaited<ReturnType<typeof channel.getVideos>> | Awaited<ReturnType<typeof channel.getContinuation>>;
  let page: Page | null = await channel.getVideos();
  while (page && videos.length < limit) {
    for (const item of page.memo.getType(module.YTNodes.LockupView)) {
      if (item.content_type !== "VIDEO" || videos.some((video) => video.id === item.content_id)) continue;
      const parts = (item.metadata?.metadata?.metadata_rows?.flatMap((row) => row.metadata_parts ?? []) ?? [])
        .map((part) => part.text?.toString() ?? "");
      if (parts.some((text) => UPCOMING.test(text))) continue;
      const image = item.content_image?.is(module.YTNodes.ThumbnailView) ? item.content_image.image : [];
      videos.push({
        id: item.content_id,
        title: item.metadata?.title?.toString() ?? "",
        publishedText: parts.find((text) => /\bago$/.test(text)),
        thumbnailUrl: image?.[0]?.url,
      });
    }
    page = page.has_continuation && videos.length < limit ? await page.getContinuation() : null;
  }
  return videos.slice(0, limit);
}

export function resetYoutube(): void {
  videoCache.clear();
  activeResolutions.clear();
  clientPromise = null;
}
