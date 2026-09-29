import type { GloomPlugin, GloomPluginContext } from "gloomberb/types/plugin";
import { attachNewsmapCache, resetNewsmapCache } from "./cache";
import { googleNewsCapability } from "./capability";
import { EDITION_CONFIG_KEY, PROVIDER_SCOPE_CONFIG_KEY, setConfigContext } from "./config";
import { createNewsmapHeadless } from "./headless";
import { setPluginContext } from "./gloom-news";
import { NewsmapPane } from "./pane";
import {
  DEFAULT_DENSITY, DEFAULT_EDITION_ID, DEFAULT_PROVIDER_SCOPE, DEFAULT_SECTIONS, DENSITIES,
  EDITIONS, NEWSMAP_PANE_ID, NEWSMAP_PLUGIN_ID, PROVIDER_SCOPES, SECTIONS,
} from "./types";

export const newsmapPlugin: GloomPlugin = {
  id: NEWSMAP_PLUGIN_ID,
  name: "News Heatmap",
  version: "0.1.0",
  description: "World news as a treemap — bigger is more important, brighter is newer",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],

  // Google News sends no CORS headers, so the web build proxies the feed; the
  // terminal and desktop go direct. Either way the domain has to be declared.
  hosts: ["news.google.com"],

  capabilities: [googleNewsCapability],

  // The pane's edition is per-pane, but the `news` capability answers the whole
  // app with no pane attached, so the edition it serves lives here.
  configSchema: [{
    key: EDITION_CONFIG_KEY,
    label: "Default edition",
    description: "Which Google News regional edition new panes open on, and the one the news provider serves.",
    type: "select",
    required: false,
    defaultValue: DEFAULT_EDITION_ID,
    options: EDITIONS.map((edition) => ({ value: edition.id, label: edition.label })),
  }, {
    key: PROVIDER_SCOPE_CONFIG_KEY,
    label: "News provider scope",
    description: "What this plugin contributes to Gloomberb's own news feeds. The heatmap pane is unaffected.",
    type: "select",
    required: false,
    defaultValue: DEFAULT_PROVIDER_SCOPE,
    options: PROVIDER_SCOPES.map((scope) => ({ value: scope.id, label: scope.label })),
  }],

  panes: [{
    id: NEWSMAP_PANE_ID,
    name: "News Heatmap",
    icon: "N",
    component: NewsmapPane,
    defaultPosition: "right",
    defaultMode: "floating",
    // Matches the other treemap panes in the ecosystem.
    defaultFloatingSize: { width: 110, height: 36 },
    settings: {
      title: "News Heatmap",
      // Declared, or the dialog opens showing Sections unticked while the map
      // is drawing four of them.
      values: {
        source: "google",
        edition: DEFAULT_EDITION_ID,
        sections: [...DEFAULT_SECTIONS],
        density: DEFAULT_DENSITY,
      },
      fields: [
        {
          key: "source",
          label: "Feed",
          description: "Google News, or Gloomberb's own market news.",
          type: "select",
          options: [
            { value: "google", label: "Google News" },
            { value: "gloom", label: "Gloomberb news" },
          ],
        },
        {
          key: "edition",
          label: "Edition",
          description: "Which Google News regional edition to read. Google News only.",
          type: "select",
          options: EDITIONS.map((edition) => ({ value: edition.id, label: edition.label })),
        },
        {
          key: "density",
          label: "Density",
          description: "How much of the pane one story gets. Tiles never shrink below what a headline needs.",
          type: "select",
          options: DENSITIES.map((option) => ({
            value: option.id,
            label: option.label,
            description: option.description,
          })),
        },
        {
          key: "sections",
          label: "Sections",
          description: "Which Google News sections to merge into the map.",
          type: "multi-select",
          options: SECTIONS.map((section) => ({ value: section.id, label: section.label })),
        },
      ],
    },
  }],

  paneTemplates: [{
    id: "newsmap-pane",
    paneId: NEWSMAP_PANE_ID,
    label: "News Heatmap",
    description: "World news as a treemap, sized by importance and faded by age",
    keywords: ["news", "heatmap", "treemap", "newsmap", "headlines", "world"],
    shortcut: { prefix: "NMAP" },
    createInstance: () => ({ placement: "floating" }),
    // Gives `gloomberb fn NMAP` and a "ready" catalog entry. Without it the
    // host falls back to screenshotting the pane and scraping the text back.
    headless: createNewsmapHeadless(),
  }],

  setup(ctx: GloomPluginContext) {
    // Three things ride on the context: the host news feed the pane can switch
    // to, the configured edition the capability serves, and the persistence the
    // feed cache writes through.
    setPluginContext(ctx);
    setConfigContext(ctx);
    attachNewsmapCache(ctx.persistence);
  },

  dispose() {
    setPluginContext(null);
    setConfigContext(null);
    resetNewsmapCache();
  },
};

export default newsmapPlugin;
