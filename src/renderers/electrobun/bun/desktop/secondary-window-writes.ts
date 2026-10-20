/**
 * What a secondary window may not ask for. Its view holds the layout with its
 * own grid swapped into the main window's place, and it never sends its state
 * back, so a config, session or pane-state write from it would overwrite the
 * main window's with a stale or swapped copy. Moving panes goes through the
 * host's own window requests instead.
 */
const SECONDARY_WINDOW_READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  "config.save",
  "config.export",
  "session.set",
  "session.delete",
  "desktop.syncMainState",
  "desktop.replaceDetachedPaneState",
  "desktop.setThemePreview",
  // Only the main window offers Restart.
  "update.apply",
]);

export function secondaryWindowMayRequest(method: string): boolean {
  return !SECONDARY_WINDOW_READ_ONLY_METHODS.has(method);
}
