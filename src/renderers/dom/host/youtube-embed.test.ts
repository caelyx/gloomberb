import { expect, test } from "bun:test";
import { readYoutubeEmbedMessage, YOUTUBE_EMBED_ORIGIN } from "./youtube-embed";

// Downstream. The messages below are the shapes YouTube's embed sent after the
// listening handshake, captured from a live player in Chromium.

test("reads state and mute from the player's deliveries", () => {
  expect(readYoutubeEmbedMessage(JSON.stringify({
    event: "initialDelivery",
    info: { muted: false, volume: 100, playerState: -1, videoData: { video_id: "dgqEoriQ4yI" } },
  }))).toEqual({ state: "paused", muted: false });
  expect(readYoutubeEmbedMessage(JSON.stringify({ event: "infoDelivery", info: { muted: true, volume: 100 } })))
    .toEqual({ muted: true });
  expect(readYoutubeEmbedMessage(JSON.stringify({ event: "infoDelivery", info: { playerState: 1 } })))
    .toEqual({ state: "playing" });
  expect(readYoutubeEmbedMessage(JSON.stringify({ event: "onStateChange", info: 3 }))).toEqual({ state: "loading" });
});

test("turns a refused embed into a reason the viewer can act on", () => {
  expect(readYoutubeEmbedMessage(JSON.stringify({ event: "onError", info: 150 })))
    .toEqual({ error: "The video's owner does not allow it to be played here." });
  expect(readYoutubeEmbedMessage(JSON.stringify({ event: "onError", info: 2 }))?.error)
    .toBe("YouTube could not play this video (error 2).");
});

test("ignores what it does not use, and anything malformed", () => {
  for (const data of [
    JSON.stringify({ event: "onReady", info: null }),
    JSON.stringify({ event: "apiInfoDelivery", info: {} }),
    JSON.stringify({ event: "infoDelivery", info: { volume: 100 } }),
    JSON.stringify({ event: "onStateChange", info: 42 }),
    JSON.stringify({ event: "onError", info: "150" }),
    "not json",
    null,
    42,
  ]) {
    expect(readYoutubeEmbedMessage(data)).toBeNull();
  }
});

test("only YouTube's player origins are trusted", () => {
  expect(YOUTUBE_EMBED_ORIGIN.test("https://www.youtube.com")).toBe(true);
  expect(YOUTUBE_EMBED_ORIGIN.test("https://www.youtube-nocookie.com")).toBe(true);
  for (const origin of ["http://www.youtube.com", "https://www.youtube.com.evil.example", "https://evil.example"]) {
    expect(YOUTUBE_EMBED_ORIGIN.test(origin)).toBe(false);
  }
});
