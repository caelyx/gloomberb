import { describe, expect, test } from "bun:test";
import { createMenuEchoGate } from "./menu-echo";

describe("createMenuEchoGate", () => {
  test("one press arriving as a keydown and a menu command runs once, in either order", () => {
    let clock = 0;
    const gate = createMenuEchoGate({ now: () => clock });

    expect(gate("command-bar", "key")).toBe(true);
    clock += 3;
    expect(gate("command-bar", "menu")).toBe(false);

    clock += 1000;
    expect(gate("command-bar", "menu")).toBe(true);
    clock += 1;
    expect(gate("command-bar", "key")).toBe(false);
  });

  test("separate presses, a mouse click on the menu, and other shortcuts all run", () => {
    let clock = 0;
    const gate = createMenuEchoGate({ now: () => clock });

    expect(gate("command-bar", "menu")).toBe(true);
    clock += 400;
    expect(gate("command-bar", "menu")).toBe(true);
    clock += 400;
    expect(gate("command-bar", "key")).toBe(true);
    clock += 200;
    expect(gate("command-bar", "menu")).toBe(true);

    clock += 1000;
    expect(gate("command-bar", "key")).toBe(true);
    expect(gate("ticker-search", "menu")).toBe(true);
    // A third arrival after an echo is a new press.
    expect(gate("command-bar", "menu")).toBe(false);
    expect(gate("command-bar", "key")).toBe(true);
  });
});
