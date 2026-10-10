import type { GloomPlugin } from "gloomberb/types/plugin";

import { HackerNewsPane } from "./pane";
import { DEFAULT_GEMINI_MODEL } from "./summary";
import { HACKERNEWS_PANE_ID, HACKERNEWS_PLUGIN_ID } from "./types";

/**
 * The reference Gloomberb plugin.
 *
 * It is deliberately small and uses only the public `gloomberb/*` API, so it is
 * the shortest path from "I want to add a pane" to something that runs. Copy
 * this repository, rename the ids, and replace `client.ts`.
 *
 * See https://github.com/gloom-sh/gloomberb/blob/main/PLUGINS.md for the full API.
 */
export const hackerNewsPlugin: GloomPlugin = {
  id: HACKERNEWS_PLUGIN_ID,
  name: "Hacker News",
  version: "0.2.0",
  description: "Hacker News front page, with Show, Ask, New, and Best, and article text in place",
  homepage: "https://github.com/caelyx/gloom-hackernews",
  toggleable: true,

  // Only HTTP reads and pure-JS parsing, so this plugin loads on every
  // renderer. A plugin touching the filesystem or a socket would narrow this —
  // see the IBKR Gateway plugin, which is ["cli", "tui", "desktop"]. On the web
  // article pages, and so summaries, cannot load: the hosted app only reaches
  // hosts listed in `hosts`, and article sites cannot be listed.
  targets: ["cli", "tui", "desktop", "web"],

  // Article pages come from whatever site a story links to, which no list of
  // hosts can name; these are the fixed ones.
  hosts: ["hacker-news.firebaseio.com", "generativelanguage.googleapis.com"],

  // Optional, so the plugin never reports "needs setup": without a key the
  // pane still shows article text, and `s` explains where the key goes.
  configSchema: [
    {
      key: "geminiApiKey",
      label: "Gemini API key",
      type: "password",
      required: false,
      placeholder: "From aistudio.google.com/apikey",
      description: "Enables s to summarise an article. Free-tier requests may be used by Google to improve its models.",
    },
    {
      key: "geminiModel",
      label: "Gemini model",
      type: "text",
      required: false,
      defaultValue: DEFAULT_GEMINI_MODEL,
      description: "Any model id that supports generateContent.",
    },
  ],

  panes: [
    {
      id: HACKERNEWS_PANE_ID,
      name: "Hacker News",
      icon: "Y",
      component: HackerNewsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 34 },
    },
  ],

  // Pane templates make the pane reachable from the command bar. `HN` opens it.
  paneTemplates: [
    {
      id: "hackernews-pane",
      paneId: HACKERNEWS_PANE_ID,
      label: "Hacker News",
      description: "Browse the Hacker News front page — Top, New, Best, Show, and Ask — with scores, comment counts, and one-key article opening.",
      keywords: ["hacker", "news", "hn", "ycombinator", "tech"],
      shortcut: { prefix: "HN" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};

export default hackerNewsPlugin;
