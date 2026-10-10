/** ABC News (Australia) on YouTube: the 24/7 ABC NEWS channel and its uploads. */
export const ABC_CHANNEL_ID = "UCVgO39Bk5sMo66-6o6Spn6Q";
export const ABC_LIVE_URL = "https://www.youtube.com/@abcnewsaustralia/live";
export const ABC_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${ABC_CHANNEL_ID}`;
export const ABC_PANE_ID = "abc-news";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isYoutubeVideoId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_VIDEO_ID.test(value);
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
