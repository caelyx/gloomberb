import type { SavedLayout } from "../../types/config";

/**
 * Downstream (private deployment): the workspace a fresh browser opens with.
 *
 * Used only when the browser has no saved config. A returning visitor's saved
 * layouts always win, and nothing here is written over them. Set
 * `PRIVATE_DEFAULT_LAYOUT` to null to go back to upstream's research workspace.
 *
 * Every pane here reads public data, so the first visit works signed out of
 * Gloom. Hacker News (`HN`) and ASX announcements (`ASX`) are left to the
 * command bar: ASX follows a ticker, which a first visit does not have yet.
 * The upstream research workspace stays available as the second layout.
 *
 * To change it, edit the panes below. `paneId` is the pane a plugin registers
 * (`market-heatmap`, `fear-greed`, `newsmap`, `hackernews`, ...); `instanceId`
 * is any unique name of the form `<paneId>:<suffix>`.
 */
export const PRIVATE_DEFAULT_LAYOUT: SavedLayout | null = {
  name: "Markets",
  layout: {
    dockRoot: {
      kind: "split",
      axis: "horizontal",
      ratio: 0.55,
      first: { kind: "pane", instanceId: "market-heatmap:private" },
      second: {
        kind: "split",
        axis: "vertical",
        ratio: 0.6,
        first: { kind: "pane", instanceId: "newsmap:private" },
        second: { kind: "pane", instanceId: "fear-greed:private" },
      },
    },
    instances: [
      { instanceId: "market-heatmap:private", paneId: "market-heatmap", binding: { kind: "none" } },
      { instanceId: "newsmap:private", paneId: "newsmap", binding: { kind: "none" } },
      { instanceId: "fear-greed:private", paneId: "fear-greed", binding: { kind: "none" } },
    ],
    floating: [],
    detached: [],
  },
  focusedPaneId: "market-heatmap:private",
};
