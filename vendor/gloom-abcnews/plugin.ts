import type { GloomPlugin } from "gloomberb/types/plugin";
import { ABC_PANE_ID } from "./channel";
import { AbcNewsPane } from "./pane";

export const abcNewsPlugin: GloomPlugin = {
  id: "abc-news",
  name: "ABC News",
  version: "0.1.0",
  description: "ABC NEWS Australia live, and its latest stories.",
  homepage: "https://github.com/caelyx/gloom-abcnews",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["youtube.com", "www.youtube.com", "googlevideo.com", "ytimg.com"],
  panes: [{
    id: ABC_PANE_ID,
    name: "ABC News",
    icon: "A",
    component: AbcNewsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 92, height: 32 },
  }],
  paneTemplates: [{
    id: "abc-news-pane",
    paneId: ABC_PANE_ID,
    label: "ABC News",
    description: "ABC NEWS Australia live, and its latest stories.",
    keywords: ["abc", "abc news", "australia", "australian", "news", "tv", "television", "live", "live stream", "stories"],
    shortcut: { prefix: "TVABC" },
  }],
};
