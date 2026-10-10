import { describe, expect, test } from "bun:test";
import type { CommandDef, PinTickerOptions } from "gloomberb/types/plugin";
import type { TickerRecord } from "gloomberb/types/ticker";
import { FRANKING_TAB_ID, frankingCode, registerFrankingCommand } from "./command";

describe("frankingCode", () => {
  test("a typed code is read as ASX's; without one, the selected ticker if it lists on ASX", () => {
    expect(frankingCode("cba", null)).toBe("CBA");
    expect(frankingCode(" BHP.AX ", "AAPL")).toBe("BHP");
    expect(frankingCode("VAS:XWBO", null)).toBe("VAS");
    expect(frankingCode("", "WES.AX")).toBe("WES");
    expect(frankingCode(undefined, "AAPL")).toBeNull();
    expect(frankingCode(undefined, null)).toBeNull();
    const ticker = { metadata: { ticker: "NAB", exchange: "ASX" } } as unknown as TickerRecord;
    expect(frankingCode(undefined, "NAB", ticker)).toBe("NAB");
  });
});

describe("FRANK command", () => {
  function setup() {
    let command: CommandDef | null = null;
    let onSelected: ((payload: { symbol: string | null; previous: string | null }) => void) | null = null;
    const pinned: Array<[string, PinTickerOptions | undefined]> = [];
    registerFrankingCommand({
      registerCommand: (def) => { command = def; },
      pinTicker: (symbol, options) => { pinned.push([symbol, options]); },
      on: ((_event: string, handler: typeof onSelected) => { onSelected = handler; return () => {}; }) as never,
      getTicker: () => null,
    });
    return { command: command!, select: (symbol: string) => onSelected!({ symbol, previous: null }), pinned };
  }

  test("opens Ticker Research on the Franking tab for the typed or selected ASX ticker", async () => {
    const { command, select, pinned } = setup();
    expect(command.shortcut).toBe("FRANK");
    expect(command.keywords).toContain("franking");
    await command.execute({ shortcut: "cba" });
    select("BHP.AX");
    await command.execute();
    expect(pinned).toEqual([["CBA.AX", { tabId: FRANKING_TAB_ID }], ["BHP.AX", { tabId: FRANKING_TAB_ID }]]);
  });

  test("without an ASX ticker it says what to type", () => {
    const { command, select } = setup();
    select("AAPL");
    expect(() => command.execute()).toThrow("FRANK CBA");
  });
});
