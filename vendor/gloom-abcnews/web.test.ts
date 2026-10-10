import { expect, test } from "bun:test";
import { ABC_CHANNEL_ID } from "./channel";
import { createWebServices } from "./web";

const NOW = Date.parse("2026-10-10T12:00:00Z");

function fakeFetch(responses: Record<string, Response>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const response = responses[url];
    if (!response) throw new Error(`unexpected fetch ${url}`);
    return response;
  };
  return { calls, fetch };
}

function embed(mediaUrl: string) {
  const url = new URL(mediaUrl);
  return { path: url.origin + url.pathname, params: Object.fromEntries(url.searchParams) };
}

test("live is the channel's live embed, muted, and needs no lookup", async () => {
  const { calls, fetch } = fakeFetch({});
  const live = await createWebServices({ fetch, now: () => NOW }).live({ force: true });
  expect(embed(live.mediaUrl)).toEqual({
    path: "https://www.youtube.com/embed/live_stream",
    params: { autoplay: "1", enablejsapi: "1", channel: ABC_CHANNEL_ID, mute: "1" },
  });
  expect(live).toMatchObject({ isLive: true, watchUrl: "https://www.youtube.com/@abcnewsaustralia/live", resolvedAt: NOW });
  expect(calls).toEqual([]);
});

test("a story embeds with sound", async () => {
  const story = await createWebServices({ fetch: fakeFetch({}).fetch, now: () => NOW }).video("YVOEzEhbATA", { force: false });
  expect(embed(story.mediaUrl)).toEqual({
    path: "https://www.youtube.com/embed/YVOEzEhbATA",
    params: { autoplay: "1", enablejsapi: "1" },
  });
  expect(story).toMatchObject({
    isLive: false,
    watchUrl: "https://www.youtube.com/watch?v=YVOEzEhbATA",
    posterUrl: "https://i.ytimg.com/vi/YVOEzEhbATA/hqdefault.jpg",
  });
});

test("stories come from the channel's feed", async () => {
  const xml = await Bun.file(new URL("./fixtures/feed.xml", import.meta.url)).text();
  const { calls, fetch } = fakeFetch({
    [`https://www.youtube.com/feeds/videos.xml?channel_id=${ABC_CHANNEL_ID}`]: new Response(xml),
  });
  const stories = await createWebServices({ fetch, now: () => NOW }).stories({ force: false });
  expect(stories.map((story) => story.id)).toEqual(["YVOEzEhbATA", "FPA18sVa9es"]);
  expect(calls).toHaveLength(1);
});
