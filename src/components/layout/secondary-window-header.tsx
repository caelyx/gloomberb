import { useCallback } from "react";
import { Box, useRendererHost, useUiCapabilities } from "../../ui";
import { useThemeColors } from "../../theme/theme-context";
import { WindowControls, WINDOWS_CONTROL_GROUP_WIDTH_PX } from "./window-controls";

/**
 * A secondary window's title bar: the strip that drags the window and holds
 * its native or Windows caption buttons, at the main header's height so the
 * grid below lines up with the main window's. The command prompt, market
 * summary and update status stay in the main window's header.
 */
export function SecondaryWindowHeader() {
  const colors = useThemeColors();
  const rendererHost = useRendererHost();
  const { titleBarOverlay, nativeWindowChrome = titleBarOverlay, windowControls } = useUiCapabilities();
  const showWindowControls = nativeWindowChrome && windowControls === "windows";
  const startWindowDrag = useCallback(() => {
    if (titleBarOverlay && nativeWindowChrome) void rendererHost.startWindowDrag?.();
  }, [nativeWindowChrome, rendererHost, titleBarOverlay]);

  return (
    <Box
      flexDirection="row"
      height={1}
      alignItems="center"
      backgroundColor={colors.header}
      data-gloom-role="app-header"
      data-titlebar-overlay={titleBarOverlay ? "true" : undefined}
      onMouseDown={startWindowDrag}
    >
      <Box flexGrow={1} />
      {showWindowControls ? <Box flexShrink={0} width={`${WINDOWS_CONTROL_GROUP_WIDTH_PX}px`} /> : null}
      {showWindowControls ? <WindowControls /> : null}
    </Box>
  );
}
