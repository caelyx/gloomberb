import type { GloomPlugin, PaneProps, TickerResearchTabProps } from "gloomberb/types/plugin";
import { createAsxCaches } from "./asx/cache";
import { AsxClient } from "./asx/client";
import { AsxAnnouncementsService } from "./asx/service";
import { isAsxTicker } from "./asx/ticker";
import { PLUGIN_HOSTS } from "./asx/urls";
import { ASX_REGISTRATION_ID, AsxAnnouncementsView } from "./ui/announcements-view";
import { PLUGIN_HOMEPAGE, PLUGIN_ID, PLUGIN_VERSION } from "./version";

const DESCRIPTION = "ASX company announcements for the selected ticker, with an extract of each PDF and a link to open it.";

/** An explicit symbol or command-bar argument wins; otherwise the ticker the user is on. */
function templateSymbol(activeTicker: string | null, options?: { symbol?: string | null; arg?: string }): string | null {
  return options?.symbol?.trim().toUpperCase() || options?.arg?.trim().toUpperCase() || activeTicker || null;
}

export function createAsxPlugin(): GloomPlugin {
  const caches = createAsxCaches();
  // Built in setup(), once the plugin's persistence and config are available.
  const runtime: { service: AsxAnnouncementsService | null } = { service: null };

  function AsxTab({ width, height, focused }: TickerResearchTabProps) {
    return <AsxAnnouncementsView width={width} height={height} focused={focused} service={runtime.service} />;
  }
  function AsxPane({ width, height, focused }: PaneProps) {
    return <AsxAnnouncementsView width={width} height={height} focused={focused} service={runtime.service} />;
  }

  return {
    id: PLUGIN_ID,
    name: "ASX Announcements",
    version: PLUGIN_VERSION,
    description: DESCRIPTION,
    homepage: PLUGIN_HOMEPAGE,
    toggleable: true,
    // Off the terminal, requests go through Gloomberb's proxy, which caps body
    // size and (in 0.15.2) carries bodies as text, damaging PDFs; the extract
    // then says it is unavailable and the PDF still opens.
    targets: ["cli", "tui", "desktop", "web"],
    hosts: PLUGIN_HOSTS,
    configSchema: [
      {
        key: "accessToken",
        label: "Markit Digital access token",
        type: "password",
        required: false,
        description: "Leave empty unless PDF downloads fail with 401 or 403. See docs/live-testing.md in the plugin repository.",
      },
    ],
    panes: [
      {
        id: ASX_REGISTRATION_ID,
        name: "ASX",
        icon: "A",
        component: AsxPane,
        defaultPosition: "right",
        defaultMode: "floating",
        defaultFloatingSize: { width: 100, height: 32 },
        tableExport: true,
      },
    ],
    paneTemplates: [
      {
        id: `${ASX_REGISTRATION_ID}-pane`,
        paneId: ASX_REGISTRATION_ID,
        label: "ASX announcements",
        description: "ASX company announcements for the selected ticker.",
        keywords: ["asx", "announcements", "australia", "filings", "disclosure", "price sensitive"],
        shortcut: { prefix: "ASX", argPlaceholder: "ticker", argKind: "ticker" },
        // Without a fixed binding the floating pane has no ticker to follow and shows "No ticker selected".
        canCreate: (context, options) => templateSymbol(context.activeTicker, options) !== null,
        createInstance: (context, options) => {
          const symbol = templateSymbol(context.activeTicker, options);
          return symbol
            ? {
              // One pane per ticker: opening ASX again for the same ticker focuses it instead of adding another.
              instanceId: `${ASX_REGISTRATION_ID}:${encodeURIComponent(symbol).replace(/%/g, "~")}`,
              title: `ASX ${symbol}`,
              binding: { kind: "fixed", symbol },
              placement: "floating",
            }
            : null;
        },
      },
    ],

    setup(ctx) {
      caches.attach(ctx.persistence);
      const accessToken = ctx.configState.get<string>("accessToken")?.trim() || null;
      runtime.service = new AsxAnnouncementsService(new AsxClient({ accessToken }), caches);
      ctx.registerTickerResearchTab({
        id: "asx",
        name: "ASX",
        order: 46,
        component: AsxTab,
        instruments: ["equity", "fund"],
        isVisible: ({ ticker }) => isAsxTicker(ticker),
      });
    },

    dispose() {
      runtime.service = null;
      caches.reset();
    },
  };
}
