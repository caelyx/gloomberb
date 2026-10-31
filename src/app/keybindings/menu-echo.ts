/**
 * On the desktop, one press of a shortcut that is also a native menu
 * accelerator (Cmd+K for the bar) reaches the view twice: as the menu command
 * and as a keydown, a few milliseconds apart and in either order. The keydown
 * toggles the bar and the menu opens it, so a press that closes the bar would
 * open it again. Whichever arrives second inside the window is the echo.
 */
const MENU_ECHO_WINDOW_MS = 150;

type EchoSource = "key" | "menu";

export function createMenuEchoGate(options: { windowMs?: number; now?: () => number } = {}) {
  const windowMs = options.windowMs ?? MENU_ECHO_WINDOW_MS;
  const now = options.now ?? (() => performance.now());
  const last = new Map<string, { source: EchoSource; at: number }>();
  /** True when this arrival should run; false when it echoes the other source's press of `channel`. */
  return (channel: string, source: EchoSource): boolean => {
    const at = now();
    const previous = last.get(channel);
    if (previous && previous.source !== source && at - previous.at < windowMs) {
      // Each press has one echo: a third arrival is a new press.
      last.delete(channel);
      return false;
    }
    last.set(channel, { source, at });
    return true;
  };
}

/** The view's gate, shared by the key handler and the menu runtime. */
export const shouldRunShortcut = createMenuEchoGate();
