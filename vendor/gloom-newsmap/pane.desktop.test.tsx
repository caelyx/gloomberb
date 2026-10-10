import { expect, mock, test } from "bun:test";
import { act, useReducer, type ReactNode } from "react";
import {
  appReducer, createInitialState, createTestPaneConfig, TestPaneProvider,
  type PluginRuntimeAccess,
} from "gloomberb/test-support";
import { setPluginContext } from "./gloom-news";
import * as realCache from "./cache";

/**
 * `gloomberb/test-support` is OpenTUI-backed by design, so the desktop tile —
 * a DOM branch the terminal harness never reaches — has no public way in, and
 * these two come out of the host link by path instead. That is the fragile
 * part of this file: move either module upstream and this is what breaks.
 *
 * The specifier is built rather than written, so the path stays out of the
 * typechecked program. Spelled as a literal, it pulls the host's whole source
 * tree in a second time — once as `node_modules/gloomberb`, once as the
 * directory the link points at — and `tsc` then reports the host's own types
 * as two incompatible ones.
 */
const HOST_DOM = "./node_modules/gloomberb/src/renderers/dom";

const { createDomTestHarness } = await import(`${HOST_DOM}/test-utils`) as {
  createDomTestHarness: (options?: { capabilities?: Record<string, unknown> })
  => { render: (node: ReactNode) => Promise<HTMLElement> };
};
const { WebInputHostProvider } = await import(`${HOST_DOM}/input-host`) as {
  WebInputHostProvider: (props: { children: ReactNode }) => ReactNode;
};

/**
 * The pane draws tiles twice: `TerminalTile` hand-wraps through
 * `model.tileLines`, and `DesktopTile` hands the whole headline to the browser
 * with a line clamp. Everything else in the suite exercises the first one, so
 * the second went out shipping headlines the tile cut off at its edge: the
 * host's `Text` is `white-space: pre` until it is asked to wrap, and a clamp
 * can only count lines the text was allowed to break into.
 *
 * happy-dom has no layout and drops `display: -webkit-box` and
 * `-webkit-line-clamp` as unknown values, so what a tile does with the rows it
 * has cannot be asserted here — only that the headline is allowed to use them.
 */

const NO_RUNTIME = {} as PluginRuntimeAccess;
const now = Date.now();
const HEADLINE = "Central bank lifts rates to the highest level in fifteen years";

/** The Google path is stubbed at the cache boundary, as in `pane.test.tsx`, so nothing reaches the network. */
const loadFeed = mock(async () => ({ headlines: [], failedSections: [], fetchedAt: Date.now(), stale: false }));
const cachedFeed = mock(() => null);
const loadArticleUrl = mock(async (url: string) => url);
mock.module("./cache", () => ({ ...realCache, loadFeed, cachedFeed, loadArticleUrl }));

const { NewsmapPane } = await import("./pane");

const ARTICLES = [{
  id: "BUSINESS-0",
  title: HEADLINE,
  // Refused before any fetch, so opening the reader stays offline.
  url: "http://localhost/business/0",
  source: "ABC News & Headlines",
  publishedAt: new Date(now),
  topic: "BUSINESS",
  sourceCount: 5,
}];

const { render } = createDomTestHarness({ capabilities: { nativePaneChrome: true } });

/** The host's own news feed, so the desktop branch draws real tiles without the Google path. */
function fakeContext() {
  return {
    watchNewsQuery(_query: unknown, listener: (state: unknown) => void) {
      listener({ phase: "ready", articles: ARTICLES, error: null, updatedAt: now });
      return () => {};
    },
  };
}

async function mountDesktopPane(width = 90, height = 24) {
  setPluginContext(fakeContext() as never);
  const config = createTestPaneConfig("/tmp/newsmap-desktop-test-unused", {
    instanceId: "nmap",
    paneId: "newsmap",
    settings: { source: "gloom" },
  } as never);
  const state = createInitialState(config);
  state.focusedPaneId = "nmap";

  function Harness() {
    const [current, dispatch] = useReducer(appReducer, state);
    return (
      <WebInputHostProvider>
        <TestPaneProvider state={current} dispatch={dispatch} paneId="nmap" pluginId="newsmap" runtime={NO_RUNTIME}>
          <NewsmapPane paneId="nmap" paneType="newsmap" width={width} height={height} focused />
        </TestPaneProvider>
      </WebInputHostProvider>
    );
  }

  const container = await render(<Harness />);
  const tile = container.querySelector('[data-gloom-role="newsmap-tile"]') as HTMLElement | null;
  if (!tile) throw new Error("the desktop branch drew no tiles");
  const [headline, source] = [...tile.querySelectorAll("span")] as HTMLElement[];
  return { container, tile, headline: headline!, source: source! };
}

test("the headline is allowed to wrap, so the tile's line clamp has lines to count", async () => {
  const { headline } = await mountDesktopPane();

  // `pre` here is the bug: one unbreakable line, sliced off at the tile edge.
  expect(headline.style.whiteSpace).toBe("pre-wrap");
  // A headline longer than its tile is wide still has to go somewhere.
  expect(headline.style.overflowWrap).toBe("break-word");
  // Nothing is dropped on the way in: the browser does the eliding, not us.
  expect(headline.textContent).toBe(HEADLINE);
});

test("the source stays on one line, and says so itself rather than inheriting it", async () => {
  const { source } = await mountDesktopPane();

  // The meta line is the one line that must not wrap — it ellipsises instead.
  expect(source.style.whiteSpace).toBe("nowrap");
  expect(source.style.textOverflow).toBe("ellipsis");
  // Its height is budgeted in `spentPx`, so it is set here rather than left to
  // the host's cell height, which is larger and would overrun the headline's share.
  expect(source.style.lineHeight).toBe("13px");
});

test("double-click reads the story in place, with its text allowed to wrap", async () => {
  const { container, tile } = await mountDesktopPane();

  await act(async () => {
    tile.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  const message = "Links to a local network address are not fetched.";
  const text = [...container.querySelectorAll("span")].find((span) => span.textContent === message) as HTMLElement | undefined;

  expect(container.querySelector('[data-gloom-role="newsmap-tile"]')).toBeNull();
  expect(container.textContent).toContain("Outlets");
  expect(text).toBeDefined();
  // The same trap as the tile: `pre` is one line, cut off at the pane edge.
  expect(text!.style.whiteSpace).toBe("pre-wrap");
});
