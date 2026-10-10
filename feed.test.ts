import { expect, test } from "bun:test";
import { parseStoriesFeed, storySummary } from "./atom-feed";
import { mergeStories } from "./feed";

const xml = await Bun.file(new URL("./fixtures/feed.xml", import.meta.url)).text();

test("reads entries only, decoding titles and dropping the channel tag", () => {
  const stories = parseStoriesFeed(xml);
  expect(stories.map((story) => story.title)).toEqual([
    "Olympic emblems leaked & \"revealed\" early",
    "Queensland runner tackles safety concerns",
  ]);
  expect(stories[0]).toMatchObject({
    id: "YVOEzEhbATA",
    publishedAt: Date.parse("2026-10-03T10:45:00Z"),
    watchUrl: "https://www.youtube.com/watch?v=YVOEzEhbATA",
    thumbnailUrl: "https://i2.ytimg.com/vi/YVOEzEhbATA/hqdefault.jpg",
    summary: "The emblem for the Brisbane 2032 Olympics has been revealed.",
  });
});

test("keeps a Short's own link and tolerates missing media", () => {
  const short = parseStoriesFeed(xml)[1]!;
  expect(short.watchUrl).toBe("https://www.youtube.com/shorts/FPA18sVa9es");
  expect(short.thumbnailUrl).toBeUndefined();
  expect(short.summary).toBeUndefined();
});

test("a summary stops at the channel's sign-off", () => {
  expect(storySummary([
    "The emblem has been revealed.",
    "Organisers say the design was inspired by Queensland.",
    "Subscribe: http://ab.co/1svxLVE",
    "Read more here: https://www.abc.net.au/news/x",
    "",
    "#ABCNEWS #abcnewsaustralia",
  ].join("\n"))).toBe("The emblem has been revealed. Organisers say the design was inspired by Queensland.");
  expect(storySummary("Subscribe: http://ab.co/1svxLVE")).toBeUndefined();
});

test("the channel list sets the order; the feed adds exact times and summaries", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const feed = parseStoriesFeed(xml);
  const stories = mergeStories([
    { id: "YVOEzEhbATA", title: "Olympic emblems leaked | ABC NEWS", publishedText: "1 hour ago" },
    { id: "AAAAAAAAAAA", title: "Older story | The Business | ABC NEWS", publishedText: "2 hours ago" },
    // "1 day ago" spans a whole day; it must not jump ahead of the story above.
    { id: "BBBBBBBBBBB", title: "Roughly dated", publishedText: "Streamed 1 day ago" },
    { id: "CCCCCCCCCCC", title: "Undated" },
  ], feed, now);

  expect(stories.map((story) => story.id)).toEqual(["YVOEzEhbATA", "AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"]);
  expect(stories[0]).toBe(feed[0]!);
  expect(stories[1]).toMatchObject({ title: "Older story | The Business", publishedAt: now - 2 * 3_600_000 });
  expect(stories[2]!.publishedAt).toBe(now - 86_400_000);
  expect(stories[3]!.publishedAt).toBe(now - 86_400_000);
  // Shorts are not on the Videos tab, so the feed's Short is left out.
  expect(stories.some((story) => story.id === "FPA18sVa9es")).toBe(false);
});

test("without a usable channel list the feed stands alone", () => {
  const feed = parseStoriesFeed(xml);
  expect(mergeStories([], feed).map((story) => story.id)).toEqual(["YVOEzEhbATA", "FPA18sVa9es"]);
  expect(mergeStories([{ id: "not-an-id", title: "Reshaped listing" }], feed)).toBe(feed);
});
