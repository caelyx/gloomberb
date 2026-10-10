import { withDeadline } from "gloomberb/utils";
import { cleanTitle, createStoriesStore, fetchFeed } from "./atom-feed";
import { isYoutubeVideoId, watchUrl } from "./channel";
import type { AbcStory } from "./types";
import { listChannelVideos, LOOKUP_TIMEOUT_MS, type ChannelVideo } from "./youtube";

/** About two days of uploads on a normal news day. */
export const STORY_LIMIT = 45;

// 2: `description` became `summary`. 3: the list comes from the channel's Videos tab.
const storiesStore = createStoriesStore({ kind: "abcnews-stories", schemaVersion: 3 }, fetchStories);

export const attachStoriesCache = storiesStore.attach;
export const resetStoriesCache = storiesStore.reset;
export const loadStories = storiesStore.load;

/**
 * The list is the channel's Videos tab, which reaches back as far as asked
 * but only says "3 hours ago". The Atom feed has exact times and the story
 * text, but only for the latest fifteen uploads, so it fills those in. Either
 * one alone still gives a list.
 */
async function fetchStories(): Promise<AbcStory[]> {
  const [channel, feed] = await Promise.allSettled([
    withDeadline(listChannelVideos(STORY_LIMIT), LOOKUP_TIMEOUT_MS, "YouTube did not answer in time."),
    fetchFeed(),
  ]);
  if (channel.status === "rejected" && feed.status === "rejected") throw feed.reason;
  return mergeStories(
    channel.status === "fulfilled" ? channel.value : [],
    feed.status === "fulfilled" ? feed.value : [],
  );
}

const RELATIVE_AGE = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;
const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/** "3 hours ago" as a timestamp; only as precise as its unit. */
export function parseRelativeAge(text: string | undefined, now: number): number | undefined {
  const match = text?.match(RELATIVE_AGE);
  return match ? now - Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]! : undefined;
}

/**
 * Keeps the channel's newest-first order. An upload the feed also has takes
 * the feed's exact time and summary. The rest are dated from their relative
 * age, never newer than the story above them: "1 day ago" covers a whole day
 * and must not jump ahead of a story timed to the minute. With no channel
 * list the feed stands alone, Shorts included.
 */
export function mergeStories(channel: ChannelVideo[], feed: AbcStory[], now = Date.now()): AbcStory[] {
  const fromFeed = new Map(feed.map((story) => [story.id, story]));
  const stories: AbcStory[] = [];
  let floor = now;
  for (const video of channel) {
    if (!isYoutubeVideoId(video.id)) continue;
    const known = fromFeed.get(video.id);
    const publishedAt = Math.min(known?.publishedAt ?? parseRelativeAge(video.publishedText, now) ?? floor, floor);
    floor = publishedAt;
    stories.push(known ?? {
      id: video.id,
      title: cleanTitle(video.title),
      publishedAt,
      watchUrl: watchUrl(video.id),
      thumbnailUrl: video.thumbnailUrl,
    });
  }
  // A listing YouTube reshaped can parse to nothing; the feed still stands.
  return stories.length > 0 ? stories : feed;
}
