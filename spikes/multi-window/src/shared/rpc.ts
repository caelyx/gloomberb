import type { RPCSchema } from "electrobun/bun";

export type WindowKey = "main" | "w2";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface WindowStatus {
  key: WindowKey;
  frame: Rect | null;
  fullscreen: boolean;
  displayId: number | null;
}

export interface HostState {
  /** Which window the host believes is key, from native focus/blur events. */
  nativeActive: WindowKey | null;
  /** Which window last reported DOM window focus. */
  domActive: WindowKey | null;
  windows: WindowStatus[];
  displays: DisplayInfo[];
}

export type SpikeRpcSchema = {
  bun: RPCSchema<{
    requests: {
      whoami: { params: {}; response: { key: WindowKey } };
      setFullScreen: { params: { fullScreen: boolean }; response: boolean };
      moveToDisplay: { params: { displayId: number }; response: boolean };
      activateOther: { params: {}; response: boolean };
      openWindow2: { params: {}; response: boolean };
      closeSelf: { params: {}; response: boolean };
      hostState: { params: {}; response: HostState };
    };
    messages: {
      domFocus: { focused: boolean };
      log: { event: string; detail?: unknown };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      menuCommand: { command: "command-bar" | "ticker-search"; nativeActive: WindowKey | null };
      hostState: HostState;
      hostLog: { line: string };
    };
  }>;
};
