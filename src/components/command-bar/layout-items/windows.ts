import { windowMoveTargets } from "../../../layout/pane-manager/secondary-windows";
import { findPaneInstance } from "../../../types/config";
import { tf } from "../../../i18n";
import type { ResultItem } from "../list/model";
import type { LayoutItemsContext } from "./types";

/**
 * Desktop windows: move the focused pane to another window, open a new one,
 * close this one, or bring another forward. Only in the desktop app's main
 * and secondary windows.
 */
export function buildWindowLayoutItems({
  closeAll,
  currentLayout,
  focusedPaneId,
  windowCommands,
}: LayoutItemsContext): ResultItem[] {
  if (!windowCommands) return [];
  const done = () => closeAll({ revertThemePreview: false });
  const targets = windowMoveTargets(currentLayout, windowCommands.windowId);
  const items: ResultItem[] = [];

  const focusedPane = focusedPaneId ? findPaneInstance(currentLayout, focusedPaneId) : null;
  if (focusedPane) {
    for (const { target, label } of targets) {
      items.push({
        id: `window-move-pane:${target}`,
        label: tf("Move Pane to {window}", { window: label }),
        detail: "Move the focused pane to that window",
        category: "Windows",
        kind: "action",
        action: () => {
          windowCommands.movePaneToWindow(focusedPane.instanceId, target);
          done();
        },
      });
    }
  }

  items.push({
    id: "window-new",
    label: "New Window",
    detail: "Open an empty window, on the next display when there is one",
    category: "Windows",
    kind: "action",
    action: () => {
      windowCommands.addWindow();
      done();
    },
  });

  const closeWindow = windowCommands.closeWindow;
  if (closeWindow) {
    items.push({
      id: "window-close",
      label: "Close Window",
      detail: "Close this window; its panes move into the main window",
      category: "Windows",
      kind: "action",
      action: () => {
        closeWindow();
        done();
      },
    });
  }

  for (const { target, label } of targets) {
    if (target === "new") continue;
    items.push({
      id: `window-focus:${target}`,
      label: tf("Go to {window}", { window: label }),
      detail: "Bring that window forward",
      category: "Windows",
      kind: "action",
      action: () => {
        done();
        windowCommands.focusWindow(target);
      },
    });
  }
  return items;
}
