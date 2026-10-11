export const PLUGIN_ID = "quantum";

export const PANE_IDS = {
  landscape: "quantum-landscape",
  records: "quantum-records",
  devices: "quantum-devices",
  estimates: "quantum-estimates",
} as const;

export type QuantumPaneKey = keyof typeof PANE_IDS;
