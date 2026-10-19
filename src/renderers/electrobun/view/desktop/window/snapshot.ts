import { findPaneInstance } from "../../../../../types/config";
import type { DesktopSharedStateSnapshot } from "../../../../../types/desktop-window";
import { viewLayoutFromWindow } from "../../../../../layout/pane-manager/secondary-windows";

export function prepareDetachedSnapshot(
  snapshot: DesktopSharedStateSnapshot,
  paneId: string,
): DesktopSharedStateSnapshot {
  return snapshot.focusedPaneId === paneId ? snapshot : { ...snapshot, focusedPaneId: paneId };
}

/**
 * The shared state as secondary window `windowId` shows it: its own grid in
 * the main window's place, and no status bar, which stays with the main
 * window. The window never sends this back, so the swap stays here.
 */
export function prepareSecondaryWindowSnapshot(
  snapshot: DesktopSharedStateSnapshot,
  windowId: string,
): DesktopSharedStateSnapshot {
  return {
    ...snapshot,
    config: { ...snapshot.config, layout: viewLayoutFromWindow(snapshot.config.layout, windowId) },
    statusBarVisible: false,
  };
}

function collectPaneStateIds(snapshot: DesktopSharedStateSnapshot, paneId: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let currentPaneId: string | null = paneId;

  while (currentPaneId && !seen.has(currentPaneId)) {
    seen.add(currentPaneId);
    ids.push(currentPaneId);

    const instance = findPaneInstance(snapshot.config.layout, currentPaneId);
    currentPaneId = instance?.binding?.kind === "follow" ? instance.binding.sourceInstanceId : null;
  }

  return ids;
}

export function detachedSnapshotKey(snapshot: DesktopSharedStateSnapshot, paneId: string): string {
  const paneStateIds = collectPaneStateIds(snapshot, paneId);
  return JSON.stringify({
    theme: snapshot.config.theme,
    baseCurrency: snapshot.config.baseCurrency,
    portfolios: snapshot.config.portfolios,
    watchlists: snapshot.config.watchlists,
    brokerInstances: snapshot.config.brokerInstances,
    pluginConfig: snapshot.config.pluginConfig,
    disabledPlugins: snapshot.config.disabledPlugins,
    chartPreferences: snapshot.config.chartPreferences,
    instances: paneStateIds.map((id) => findPaneInstance(snapshot.config.layout, id) ?? null),
    paneState: Object.fromEntries(paneStateIds.map((id) => [id, snapshot.paneState[id] ?? {}])),
  });
}
