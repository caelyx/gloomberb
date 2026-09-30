import { afterEach, expect, mock, test } from "bun:test";
import { act, useReducer } from "react";
import {
  appReducer, createInitialState, createTestPaneConfig,
  emitKeypress, settleFrame, testRender, TestPaneProvider,
  type PluginRuntimeAccess,
} from "gloomberb/test-support";
import { setPluginContext } from "./gloom-news";

/**
 * The pane is driven through the host's own news feed rather than Google News:
 * a fake plugin context needs no module mocking and no network, and exercises
 * the same tiles, legend and keys.
 *
 * The OpenTUI renderer is native, so this file mounts as rarely as it can and
 * asserts several things per mount.
 */

// The pane reads nothing off the runtime, so an empty one stands in for the
// thirty-odd accessors the real access object carries.
const NO_RUNTIME = {} as PluginRuntimeAccess;

const HOUR = 3_600_000;
const now = Date.now();

function article(topic: string, index: number, title: string) {
  return {
    id: `${topic}-${index}`,
    title,
    url: `https://example.test/${topic}/${index}`,
    source: "Reuters",
    publishedAt: new Date(now - index * HOUR),
    topic,
    sourceCount: 5 - index,
  };
}

/**
 * The Google path is stubbed at the cache boundary rather than the network, so
 * the pane's own effect wiring is what is under test.
 */
const loadFeed = mock(async () => ({ headlines: [], failedSections: [], fetchedAt: Date.now(), stale: false }));
const cachedFeed = mock(() => null);
mock.module("./cache", () => ({ loadFeed, cachedFeed }));

const { NewsmapPane } = await import("./pane");

const ARTICLES = [
  article("BUSINESS", 0, "Central bank lifts rates"),
  article("BUSINESS", 1, "Miner halts output"),
  article("SPORTS", 2, "Grand final decided in extra time"),
  article("SPORTS", 3, "Star forward ruled out"),
];

function fakeContext() {
  return {
    watchNewsQuery(_query: unknown, listener: (state: unknown) => void) {
      listener({ phase: "ready", articles: ARTICLES, error: null, updatedAt: now });
      return () => {};
    },
  };
}

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (setup) await act(async () => setup!.renderer.destroy());
  setup = undefined;
  setPluginContext(null);
});

/**
 * Always settle before capturing: reading the char frame of a renderer that has
 * not painted yet segfaults the native renderer.
 */
async function waitForFrame(
  rendered: Awaited<ReturnType<typeof testRender>>,
  ready: (frame: string) => boolean,
  attempts = 25,
): Promise<string> {
  let frame = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await settleFrame(rendered, 15);
    frame = rendered.captureCharFrame();
    if (ready(frame)) break;
  }
  return frame;
}

async function mountPane(width = 90, height = 24, settings: Record<string, unknown> = { source: "gloom" }) {
  setPluginContext(fakeContext() as never);
  const config = createTestPaneConfig("/tmp/newsmap-pane-test-unused", {
    instanceId: "nmap",
    paneId: "newsmap",
    settings,
  } as never);
  const state = createInitialState(config);
  state.focusedPaneId = "nmap";

  function Harness() {
    const [current, dispatch] = useReducer(appReducer, state);
    return (
      <TestPaneProvider state={current} dispatch={dispatch} paneId="nmap" pluginId="newsmap" runtime={NO_RUNTIME}>
        <NewsmapPane paneId="nmap" paneType="newsmap" width={width} height={height} focused />
      </TestPaneProvider>
    );
  }

  // Not wrapped in `act`: testRender calls `act` itself, and nesting the two
  // deadlocks the first render of the process.
  setup = await testRender(<Harness />, { width, height });
  return setup;
}

/** emitKeypress commits the update; the frame it produces is painted on the next settle. */
async function press(rendered: Awaited<ReturnType<typeof testRender>>, key: string) {
  await emitKeypress(rendered, { name: key, sequence: key }, { frames: 2 });
}

test("draws the feed as labelled tiles under a section legend", async () => {
  const rendered = await mountPane();
  const frame = await waitForFrame(rendered, (painted) => painted.includes("Central bank"));

  // Headlines wrap inside their tile, so only the first word is contiguous.
  for (const story of ARTICLES) expect(frame).toContain(story.title.split(" ")[0]!);
  // Tiles with the room for it carry the source and how old the story is.
  expect(frame).toMatch(/Reuters · (now|\d+[mhd])/);
  // The legend numbers the sections it drew.
  expect(frame).toContain("1 Business");
  expect(frame).toContain("2 Sport");
}, 30_000);

test("a number key hides that section, and 0 brings it back", async () => {
  const rendered = await mountPane();
  await waitForFrame(rendered, (painted) => painted.includes("Central bank"));

  await press(rendered, "1");
  const hidden = await waitForFrame(rendered, (painted) => !painted.includes("Central bank"));
  expect(hidden).not.toContain("Central bank");
  expect(hidden).not.toContain("Miner halts");
  // What is left takes over the whole pane rather than leaving a hole.
  expect(hidden).toContain("Grand final");

  await press(rendered, "0");
  const restored = await waitForFrame(rendered, (painted) => painted.includes("Central bank"));
  expect(restored).toContain("Central bank");
  expect(restored).toContain("Grand final");
}, 30_000);

test("does not refetch in a loop under the default settings", async () => {
  // `usePaneSettingValue` hands back the caller's fallback by identity when a
  // setting has never been written, so an unstable default array used to
  // cascade into a new loader, a re-run effect, a fetch, a state change, and
  // round again — pinning Google News for as long as the pane was open. This
  // is the default configuration, so nothing else would have caught it.
  loadFeed.mockClear();
  const rendered = await mountPane(80, 20, {});
  for (let attempt = 0; attempt < 8; attempt += 1) await settleFrame(rendered, 15);
  expect(loadFeed.mock.calls.length).toBeLessThanOrEqual(2);
}, 30_000);
