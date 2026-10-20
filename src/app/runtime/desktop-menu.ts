import { useEffect, type Dispatch } from "react";
import { tidyWindows } from "../../layout/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import type { AppAction, AppState } from "../../state/app/context";
import type { DesktopApplicationMenuBridge } from "../../types/desktop-menu";
import type { DesktopWindowBridge } from "../../types/desktop-window";
import { isDialogOpen } from "../../ui/dialog-stack";
import type { RendererHost } from "../../ui/host";
import { recordFunctionOpen } from "../../telemetry/usage-counts";
import { shouldRunShortcut } from "../keybindings/menu-echo";

/** The File menu's Search Ticker opens the bar on this query. */
const TICKER_SEARCH_MENU_QUERY = "DES ";

const OPENS_OVER_DIALOGS = new Set<string>(["open-command-bar", "open-plugin-workflow", "open-builtin-workflow"]);

export function useDesktopApplicationMenuRuntime({
  desktopApplicationMenuBridge,
  desktopWindowKind,
  dispatch,
  pluginRegistry,
  rendererHost,
  runUpdateCheck,
  stateRef,
}: {
  desktopApplicationMenuBridge?: DesktopApplicationMenuBridge;
  desktopWindowKind?: DesktopWindowBridge["kind"];
  dispatch: Dispatch<AppAction>;
  pluginRegistry: PluginRegistry;
  rendererHost: RendererHost;
  runUpdateCheck: (manual?: boolean) => Promise<void>;
  stateRef: { current: AppState };
}) {
  useEffect(() => {
    // A secondary window runs its own bar; the host sends it only that.
    if ((desktopWindowKind !== "main" && desktopWindowKind !== "window") || !desktopApplicationMenuBridge) return;
    const secondary = desktopWindowKind === "window";
    return desktopApplicationMenuBridge.subscribe((command) => {
      if (secondary && command.type !== "open-command-bar") return;
      // The native menu stays reachable over a dialog, accelerators included.
      // A bar opened there would sit over the dialog without its keys, and Esc
      // would close the dialog under it; a form would stack over one the user
      // has not finished. Both wait for the dialog to close.
      if (OPENS_OVER_DIALOGS.has(command.type) && isDialogOpen()) return;
      switch (command.type) {
        case "open-command-bar": {
          // The accelerator's keydown may already have toggled the bar for this press.
          // With the bar already open, opening it changes nothing, and the press's
          // keydown, whenever it comes, is the one that closes it.
          const channel = !command.query ? "command-bar" : command.query === TICKER_SEARCH_MENU_QUERY ? "ticker-search" : null;
          if (channel === "command-bar" && stateRef.current.commandBarOpen) break;
          if (channel && !shouldRunShortcut(channel, "menu")) break;
          dispatch({ type: "SET_COMMAND_BAR", open: true, query: command.query });
          break;
        }
        case "open-plugin-workflow":
          pluginRegistry.openPluginCommandWorkflow(command.commandId);
          break;
        case "open-builtin-workflow":
          pluginRegistry.openBuiltInWorkflow(command.actionId);
          break;
        case "open-url":
          void rendererHost.openExternal(command.url).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            pluginRegistry.notify({ body: `Failed to open link: ${message}`, type: "error" });
          });
          break;
        case "check-for-updates":
          void runUpdateCheck(true);
          break;
        case "toggle-status-bar":
          dispatch({ type: "TOGGLE_STATUS_BAR" });
          break;
        case "open-layout-gallery":
          recordFunctionOpen({ shortcut: "LAY", externalPluginId: null });
          pluginRegistry.showPane("layout-marketplace");
          break;
        case "quit":
          // Through the view, so what was counted is sent before the app goes.
          rendererHost.requestExit();
          break;
        case "layout-undo":
          dispatch({ type: "UNDO_LAYOUT" });
          break;
        case "layout-redo":
          dispatch({ type: "REDO_LAYOUT" });
          break;
        case "layout-gridlock":
          tidyWindows({
            layout: stateRef.current.config.layout,
            size: pluginRegistry.getTermSize(),
            paneTypes: pluginRegistry.panes,
            apply: pluginRegistry.updateLayout,
            notify: pluginRegistry.notify,
            onRevert: () => dispatch({ type: "UNDO_LAYOUT" }),
          });
          break;
      }
    });
  }, [
    desktopApplicationMenuBridge,
    desktopWindowKind,
    dispatch,
    pluginRegistry,
    rendererHost,
    runUpdateCheck,
    stateRef,
  ]);
}
