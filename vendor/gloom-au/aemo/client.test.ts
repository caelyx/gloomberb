import { afterEach, describe, expect, test } from "bun:test";
import fiveMinute from "./fixtures/openelectricity-5m.json";
import { loadOpenElectricityRecent, openElectricityKey, resetOpenElectricityRefusal, setOpenElectricityKey } from "./client";
import { OPEN_ELECTRICITY_KEY_SETTING } from "./openelectricity";
import { CLEAR_OPEN_ELECTRICITY_KEY_COMMAND, setupOpenElectricity } from "./settings";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetOpenElectricityRefusal();
  setOpenElectricityKey(null);
});

/** Answers every request with the next response, counting them; OpenElectricity is never reached. */
function fakeFetch(...responses: Array<() => Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return next();
  }) as typeof fetch;
  return calls;
}

describe("OpenElectricity refusals", () => {
  test("a refused key is asked once, never with the server's text, and again only with a new key", async () => {
    const calls = fakeFetch(
      () => new Response(JSON.stringify({ detail: "Invalid key secret-123" }), { status: 401 }),
      () => new Response(JSON.stringify(fiveMinute), { status: 200 }),
    );
    const first = await loadOpenElectricityRecent("secret-123", { force: true }).catch((error: Error) => error);
    expect(String(first)).toMatch(/refused the API key \(401\); not asking again until the key/);
    expect(String(first)).not.toContain("secret");
    await expect(loadOpenElectricityRecent("secret-123", { force: true })).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
    const answer = await loadOpenElectricityRecent("new-key", { force: true });
    expect(answer.data.rows.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  test("out of credits waits at least an hour", async () => {
    const calls = fakeFetch(() => new Response("{}", { status: 429, headers: { "Retry-After": "30" } }));
    // The last test's answer is cached, so a failed refresh keeps it and says why.
    const failure = async () => {
      const result = await loadOpenElectricityRecent("new-key", { force: true }).catch((error: Error) => error);
      return result instanceof Error ? result.message : result.refreshError;
    };
    expect(await failure()).toMatch(/429\); not asking again before \d\d:\d\d AEST/);
    expect(await failure()).toMatch(/429/);
    expect(calls).toHaveLength(1);
  });
});

describe("OpenElectricity key outside React", () => {
  test("follows the settings, and the clear command removes it", async () => {
    const values = new Map<string, unknown>([[OPEN_ELECTRICITY_KEY_SETTING, " key-1 "]]);
    const listeners: Array<() => void> = [];
    const commands: Array<{ id: string; hidden?: () => boolean; execute: () => void | Promise<void> }> = [];
    const notices: string[] = [];
    const ctx = {
      configState: {
        get: <T,>(key: string) => (values.get(key) ?? null) as T | null,
        set: async (key: string, value: unknown) => { values.set(key, value); listeners.forEach((listener) => listener()); },
        // The host emits config:changed after a delete as after a set.
        delete: async (key: string) => { values.delete(key); listeners.forEach((listener) => listener()); },
        keys: () => [...values.keys()],
      },
      on: (_event: string, listener: () => void) => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); },
      registerCommand: (command: (typeof commands)[number]) => { commands.push(command); },
      notify: (notification: { body: string }) => { notices.push(notification.body); },
    };
    const dispose = setupOpenElectricity(ctx as never);
    expect(openElectricityKey()).toBe("key-1");
    await ctx.configState.set(OPEN_ELECTRICITY_KEY_SETTING, "key-2");
    expect(openElectricityKey()).toBe("key-2");
    const clear = commands.find((command) => command.id === CLEAR_OPEN_ELECTRICITY_KEY_COMMAND)!;
    expect(clear.hidden?.()).toBe(false);
    await clear.execute();
    expect(values.has(OPEN_ELECTRICITY_KEY_SETTING)).toBe(false);
    expect(openElectricityKey()).toBeNull();
    expect(clear.hidden?.()).toBe(true);
    expect(notices).toEqual(["OpenElectricity API key removed."]);
    dispose();
    expect(listeners).toHaveLength(0);
  });
});
