import type { GloomPlugin, PaneProps } from "gloomberb/types/plugin";
import { AcgbService, PLUGIN_HOSTS } from "./rba/client";
import { ACGB_REGISTRATION_ID, AcgbCurveView } from "./ui/curve-view";
import { PLUGIN_ID, PLUGIN_VERSION } from "./version";

const DESCRIPTION = "Australian Government bond yields by maturity from the Reserve Bank of Australia, with week and month look-backs and the US Treasury curve beside it.";

export function createAcgbPlugin(): GloomPlugin {
  // Caches in memory until setup() hands it the plugin's persistence.
  const service = new AcgbService();

  function AcgbPane({ width, height, focused }: PaneProps) {
    return <AcgbCurveView width={width} height={height} focused={focused} service={service} />;
  }

  return {
    id: PLUGIN_ID,
    name: "Australian Government Bonds Curve",
    version: PLUGIN_VERSION,
    description: DESCRIPTION,
    toggleable: true,
    targets: ["cli", "tui", "desktop", "web"],
    hosts: PLUGIN_HOSTS,
    panes: [
      {
        id: ACGB_REGISTRATION_ID,
        name: "Australian Government Bonds Curve",
        icon: "A",
        component: AcgbPane,
        defaultPosition: "right",
        defaultMode: "floating",
        defaultFloatingSize: { width: 92, height: 28 },
      },
    ],
    paneTemplates: [
      {
        id: `${ACGB_REGISTRATION_ID}-pane`,
        paneId: ACGB_REGISTRATION_ID,
        label: "Australian Government Bonds Curve",
        description: "Australian Government bond yield curve, optionally against the US Treasury curve.",
        keywords: ["acgb", "australia", "aud", "yield", "curve", "bonds", "rates", "sovereign", "rba", "spread", "treasury", "ust"],
        shortcut: { prefix: "ACGB" },
        createInstance: () => ({ placement: "floating" }),
      },
    ],

    setup(ctx) {
      service.attach(ctx.persistence);
    },

    dispose() {
      service.reset();
    },
  };
}
