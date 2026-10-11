import type { GloomPlugin, PaneDef, PaneSettingsDef, PaneTemplateDef } from "gloomberb/types/plugin";
import type { HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { DATASET } from "./src/data/generated";
import { SNAPSHOTS } from "./src/data/snapshots.generated";
import { createDevicesPane } from "./src/panes/devices";
import { createEstimatesPane } from "./src/panes/estimates";
import { createLandscapePane } from "./src/panes/landscape";
import { createRecordsPane } from "./src/panes/records";
import { LANDSCAPE_FIELDS, paneSettings } from "./src/panes/shared/settings";
import { PANE_IDS, PLUGIN_ID, type QuantumPaneKey } from "./src/ids";
import {
  devicesHeadless,
  estimatesHeadless,
  landscapeHeadless,
  recordsHeadless,
} from "./src/headless";
import { quantumCliCommand } from "./src/cli";

interface PaneSpec {
  key: QuantumPaneKey;
  name: string;
  icon: string;
  prefix: string;
  description: string;
  keywords: string[];
  headless: HeadlessPaneDefinition;
  component: PaneDef["component"];
  settings?: PaneSettingsDef;
  tableExport?: true;
  quickSettings?: PaneDef["quickSettings"];
}

const SPECS: PaneSpec[] = [
  {
    key: "landscape",
    name: "Quantum Landscape",
    icon: "Q",
    prefix: "QC",
    description: "Physical qubits against error rate, with cryptographically relevant quantum computer (CRQC) resource-estimate curves",
    keywords: ["quantum", "qubits", "error", "landscape", "crqc", "chart"],
    headless: landscapeHeadless,
    component: createLandscapePane({ dataset: DATASET }),
    settings: paneSettings("all", {
      fields: LANDSCAPE_FIELDS,
      values: { yMetric: "err_2q_register", showBestPairOnly: true, showPressOnly: false },
    }),
    // One click between the register-wide and worst-channel y axis (brief §6).
    quickSettings: [{ type: "toggle", key: "yMetric", icon: "sqrt", label: "Worst channel", onValue: "err_worst_channel" }],
  },
  {
    key: "records",
    name: "Quantum Records",
    icon: "Q",
    prefix: "QCR",
    description: "Current best result on each quantum hardware metric",
    keywords: ["quantum", "records", "logical", "qubits", "lambda"],
    headless: recordsHeadless,
    component: createRecordsPane({ dataset: DATASET, snapshots: SNAPSHOTS }),
    settings: paneSettings("all"),
    tableExport: true,
  },
  {
    key: "devices",
    name: "Quantum Devices",
    icon: "Q",
    prefix: "QCD",
    description: "Quantum hardware results in a lookback window, by modality",
    keywords: ["quantum", "devices", "hardware", "results", "processors"],
    headless: devicesHeadless,
    component: createDevicesPane({ dataset: DATASET }),
    settings: paneSettings("5"),
    tableExport: true,
  },
  {
    key: "estimates",
    name: "Quantum Estimates",
    icon: "Q",
    prefix: "QCE",
    description: "Cryptographically relevant quantum computer (CRQC) resource estimates and the gap to today's devices",
    keywords: ["quantum", "crqc", "rsa", "ecc", "estimates", "shor"],
    headless: estimatesHeadless,
    component: createEstimatesPane({ dataset: DATASET }),
    settings: paneSettings("all"),
    tableExport: true,
  },
];

const panes: PaneDef[] = SPECS.map((spec) => ({
  id: PANE_IDS[spec.key],
  name: spec.name,
  icon: spec.icon,
  component: spec.component,
  ...(spec.settings ? { settings: spec.settings } : {}),
  ...(spec.tableExport ? { tableExport: spec.tableExport } : {}),
  ...(spec.quickSettings ? { quickSettings: spec.quickSettings } : {}),
  defaultPosition: "right",
  defaultMode: "floating",
  defaultFloatingSize: { width: 120, height: 36 },
  headless: spec.headless,
}));

const paneTemplates: PaneTemplateDef[] = SPECS.map((spec) => ({
  id: `new-${PANE_IDS[spec.key]}-pane`,
  paneId: PANE_IDS[spec.key],
  label: spec.name,
  description: spec.description,
  keywords: spec.keywords,
  shortcut: { prefix: spec.prefix, argOptional: true, openWithoutArg: true },
  headless: spec.headless,
  createInstance: () => ({ placement: "floating" }),
}));

export const quantumPlugin: GloomPlugin = {
  id: PLUGIN_ID,
  name: "Quantum Computing",
  version: "0.1.0",
  description: "Curated quantum-computing hardware progress, records and CRQC resource estimates.",
  toggleable: true,
  // Bundled, hand-curated data only: no network I/O in v1 (brief D3).
  targets: ["desktop", "web", "tui", "cli"],
  hosts: [],
  panes,
  paneTemplates,
  // `gloomberb quantum records|devices|estimates`: the fn QCR/QCD/QCE reports, same headless loads.
  cliCommands: [quantumCliCommand],
  // Static definitions only; CLI pane discovery calls setup with a stub context.
  setup() {},
};

export default quantumPlugin;
