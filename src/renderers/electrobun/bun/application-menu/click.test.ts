import { describe, expect, test } from "bun:test";
import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { applicationMenuAction, buildDesktopApplicationMenu, ELECTROBUN_APPLICATION_MENU_ACTION } from "./index";
import { applicationMenuCommand, createApplicationMenuGate } from "./click";

function menuActions(items: ApplicationMenuItemConfig[]): string[] {
  return items.flatMap((item) => {
    const entry = item as { action?: string; submenu?: ApplicationMenuItemConfig[] };
    return [
      ...(entry.action ? [entry.action] : []),
      ...(entry.submenu ? menuActions(entry.submenu) : []),
    ];
  });
}

// Electrobun clears an item's `data` on its first click, so every later click
// arrives with the action string alone.
function clickWithoutData(action: string) {
  return applicationMenuCommand({ data: { action, data: undefined } });
}

describe("applicationMenuCommand", () => {
  // An item whose command cannot be read back from its action works once per
  // launch, or not at all, by mouse or by accelerator.
  test("reads every menu item's command from its action alone", () => {
    const actions = menuActions(buildDesktopApplicationMenu("darwin"));
    expect(actions.length).toBeGreaterThan(0);
    const prefix = `${ELECTROBUN_APPLICATION_MENU_ACTION}:`;
    for (const action of actions) {
      expect(action.startsWith(prefix)).toBe(true);
      expect(clickWithoutData(action)).toEqual(JSON.parse(decodeURIComponent(action.slice(prefix.length))));
    }
  });

  test("ignores other actions, unknown commands and malformed payloads", () => {
    const command = encodeURIComponent(JSON.stringify({ type: "open-command-bar", query: "DES " }));
    expect(clickWithoutData(`gloom.other-action:${command}`)).toBeNull();
    expect(clickWithoutData(ELECTROBUN_APPLICATION_MENU_ACTION)).toBeNull();
    expect(clickWithoutData(`${ELECTROBUN_APPLICATION_MENU_ACTION}:%E0%A4%A`)).toBeNull();
    expect(clickWithoutData(applicationMenuAction({ type: "unknown-command" } as never))).toBeNull();
  });
});

describe("buildDesktopApplicationMenu", () => {
  // A form item that only pre-fills the bar leaves the user one Enter short.
  test("opens the File menu's forms directly", () => {
    const commands = menuActions(buildDesktopApplicationMenu("darwin")).map(clickWithoutData);
    for (const actionId of ["new-portfolio", "new-watchlist", "set-portfolio-position", "add-broker-account"]) {
      expect(commands).toContainEqual({ type: "open-builtin-workflow", actionId });
    }
  });
});

describe("createApplicationMenuGate", () => {
  // A held accelerator reaches the Bun process as a stream of identical clicks with no repeat flag.
  test("lets a held accelerator through once, however long it is held", () => {
    let at = 1_000;
    const mayRun = createApplicationMenuGate({ now: () => at });
    const tidy = { type: "layout-gridlock" } as const;
    let runs = 0;

    for (let elapsed = 0; elapsed < 3_000; elapsed += 33) {
      if (mayRun(tidy)) runs += 1;
      at += 33;
    }

    expect(runs).toBe(1);
  });

  test("runs another command, and the same one after a pause", () => {
    let at = 1_000;
    const mayRun = createApplicationMenuGate({ now: () => at });

    expect(mayRun({ type: "open-layout-gallery" })).toBe(true);
    expect(mayRun({ type: "layout-gridlock" })).toBe(true);
    expect(mayRun({ type: "open-command-bar", query: "DES " })).toBe(true);
    expect(mayRun({ type: "open-command-bar", query: "TH " })).toBe(true);
    expect(mayRun({ type: "open-layout-gallery" })).toBe(false);

    at += 700;
    expect(mayRun({ type: "open-layout-gallery" })).toBe(true);
  });
});
