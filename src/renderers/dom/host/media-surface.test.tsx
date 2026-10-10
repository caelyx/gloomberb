/** @jsxImportSource react */
import { beforeAll, expect, test } from "bun:test";
import { act, createRef } from "react";
import type { MediaSurfaceHandle } from "../../../ui/host";
import { WebMediaSurface } from "./media-surface";
import { createDomTestHarness } from "../test-utils";

// Downstream: the YouTube embed's own reports drive the surface's state.

const { window: testWindow, render } = createDomTestHarness({ withUi: false });

beforeAll(() => {
  // The frame's page is YouTube's; nothing here needs it loaded.
  testWindow.happyDOM.settings.disableIframePageLoading = true;
});

async function renderEmbed() {
  const states: string[] = [];
  const muted: boolean[] = [];
  const errors: string[] = [];
  const handle = createRef<MediaSurfaceHandle | null>() as { current: MediaSurfaceHandle | null };
  const container = await render(
    <WebMediaSurface
      src="https://www.youtube.com/embed/dgqEoriQ4yI?autoplay=1&enablejsapi=1"
      autoPlay
      mediaHandleRef={handle}
      onPlaybackStateChange={(state) => states.push(state)}
      onMutedChange={(value) => muted.push(value)}
      onError={(message) => errors.push(message)}
    />,
  );
  const frame = container.querySelector("iframe") as unknown as HTMLIFrameElement;
  const posted: string[] = [];
  // Stands in for the player's window: what the surface posts to, and the
  // source its reports must come from.
  const frameWindow = { postMessage: (message: string) => { posted.push(JSON.parse(message).func); } };
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => frameWindow });
  const report = (data: unknown, { source = frameWindow as unknown, origin = "https://www.youtube.com" } = {}) =>
    act(async () => {
      testWindow.dispatchEvent(new testWindow.MessageEvent("message", {
        data: JSON.stringify(data),
        origin,
        source: source as never,
      }));
    });
  return { states, muted, errors, handle, posted, report, container };
}

test("reports what the player says, not what autoplay hoped for", async () => {
  const { states, muted, handle, posted, report } = await renderEmbed();
  expect(states.at(-1)).toBe("playing");

  // The browser refused to start it with sound: the player stays unstarted.
  await report({ event: "initialDelivery", info: { playerState: -1, muted: false } });
  expect(states.at(-1)).toBe("paused");

  // So `p` asks it to play, rather than pausing a player that never started.
  await act(async () => { await handle.current?.toggle(); });
  expect(posted.at(-1)).toBe("playVideo");

  await report({ event: "onStateChange", info: 1 });
  expect(states.at(-1)).toBe("playing");

  // Muted with the player's own control.
  await report({ event: "infoDelivery", info: { muted: true, volume: 100 } });
  expect(muted.at(-1)).toBe(true);
  expect(handle.current?.toggleMuted()).toBe(false);
  expect(posted.at(-1)).toBe("unMute");
});

test("a refused embed fails with the reason", async () => {
  const { states, errors, report, container } = await renderEmbed();
  await report({ event: "onError", info: 150 });
  expect(errors).toEqual(["The video's owner does not allow it to be played here."]);
  expect(states.at(-1)).toBe("error");
  expect(container.querySelector("iframe")).toBeNull();
});

test("ignores reports from any other window or origin", async () => {
  const { states, errors, report } = await renderEmbed();
  const before = [...states];
  await report({ event: "onError", info: 150 }, { source: testWindow });
  await report({ event: "onStateChange", info: 2 }, { origin: "https://evil.example" });
  expect(states).toEqual(before);
  expect(errors).toEqual([]);
});
