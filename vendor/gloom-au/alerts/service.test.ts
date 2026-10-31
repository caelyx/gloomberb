import { describe, expect, test } from "bun:test";
import type { AsxAnnouncement } from "../announcements/model";
import type { AppNotificationRequest } from "gloomberb/types/plugin";
import { createRule, type AuAlertRule } from "./rules";
import { MAX_HISTORY, createAlertService, readIntervalMinutes, type ServiceDeps } from "./service";

const MIN = 60_000;
const START = Date.parse("2026-10-09T05:00:00Z");

function halt(code: string, at: number): AsxAnnouncement {
  return {
    id: `mkt:${code}:${at}`, code, companyName: null, documentKey: null, releasedAt: at, headline: "Trading Halt",
    priceSensitive: true, category: "halt", types: ["Trading Halt"], pages: null, size: null, documentUrl: null,
  };
}

function harness(rules: AuAlertRule[], feedItems: () => AsxAnnouncement[] = () => [], over: Partial<ServiceDeps> = {}) {
  let now = START;
  const stored = new Map<string, unknown>();
  const notices: AppNotificationRequest[] = [];
  const requests: number[] = [];
  const deps: ServiceDeps = {
    readRules: () => rules,
    readIntervalMinutes: () => 60,
    persistence: {
      getState: <T,>(key: string) => (stored.get(key) as T | undefined) ?? null,
      setState: (key: string, value: unknown) => { stored.set(key, value); },
    },
    notify: (notice) => { notices.push(notice); },
    openAlert: () => {},
    openPane: () => {},
    fetchPage: async (page) => {
      requests.push(page);
      return page === 0 ? feedItems() : [];
    },
    loadDividend: async () => { throw new Error("unused"); },
    watchedCodes: async () => new Set(),
    now: () => now,
    ...over,
  };
  return { service: createAlertService(deps), stored, notices, requests, advance: (ms: number) => { now += ms; }, get now() { return now; } };
}

describe("readIntervalMinutes", () => {
  test("one of the offered intervals, else an hour", () => {
    expect(readIntervalMinutes("15")).toBe(15);
    expect(readIntervalMinutes(240)).toBe(240);
    expect(readIntervalMinutes("7")).toBe(60);
    expect(readIntervalMinutes(null)).toBe(60);
  });
});

describe("alert service", () => {
  test("no active rules: the tick asks nothing of ASX", async () => {
    const h = harness([]);
    await h.service.tick();
    expect(h.requests).toEqual([]);
    expect(h.service.getSnapshot().status.nextCheckAt).toBeNull();
  });

  test("checks at once for a new rule, then once per interval", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - MIN)]);
    await h.service.tick();
    expect(h.requests).toHaveLength(1);
    h.advance(30 * MIN);
    await h.service.tick();
    expect(h.requests).toHaveLength(1);
    expect(h.service.getSnapshot().status.nextCheckAt).toBe(START + 60 * MIN);
    h.advance(30 * MIN);
    await h.service.tick();
    expect(h.requests).toHaveLength(2);
  });

  test("the last check survives a restart, so reopening the app does not check again early", async () => {
    const rules = [createRule({ event: "halt", scope: "market" }, [], START - MIN)];
    const h = harness(rules);
    await h.service.tick();
    const reopened = createAlertService({
      readRules: () => rules, readIntervalMinutes: () => 60,
      persistence: { getState: <T,>(key: string) => (h.stored.get(key) as T | undefined) ?? null, setState: () => {} },
      notify: () => {}, openAlert: () => {}, openPane: () => {},
      fetchPage: async () => { throw new Error("should not be asked"); },
      loadDividend: async () => { throw new Error("unused"); }, watchedCodes: async () => new Set(),
      now: () => START + 10 * MIN,
    });
    await reopened.tick();
    expect(reopened.getSnapshot().status.lastCheckAt).toBe(START);
  });

  test("a last check dated ahead of the clock (a clock change) does not stop checks", async () => {
    const rules = [createRule({ event: "halt", scope: "market" }, [], START - MIN)];
    const stored = new Map<string, unknown>([["au-alerts:state", { cursor: null, firedKeys: [], lastCheckAt: START + 30 * 24 * 60 * MIN }]]);
    let asked = 0;
    const service = createAlertService({
      readRules: () => rules, readIntervalMinutes: () => 60,
      persistence: { getState: <T,>(key: string) => (stored.get(key) as T | undefined) ?? null, setState: () => {} },
      notify: () => {}, openAlert: () => {}, openPane: () => {},
      fetchPage: async () => { asked += 1; return []; },
      loadDividend: async () => { throw new Error("unused"); }, watchedCodes: async () => new Set(),
      now: () => START,
    });
    await service.tick();
    expect(asked).toBe(1);
  });

  test("notifications name the company when the directory knows it", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - 10 * MIN)], () => [halt("NMR", START - 1000)], {
      companyNames: async () => new Map([["NMR", "NATIVE MINERAL RESOURCES HOLDINGS LIMITED"]]),
    });
    await h.service.checkNow();
    expect(h.notices[0]!.title).toBe("ASX alert · NMR · NATIVE MINERAL RESOURCES HOLDINGS LIMITED");
    expect(h.service.getSnapshot().history[0]!.companyName).toBe("NATIVE MINERAL RESOURCES HOLDINGS LIMITED");
  });

  test("a directory failure only leaves the name out", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - 10 * MIN)], () => [halt("NMR", START - 1000)], {
      companyNames: async () => { throw new Error("HTTP 500"); },
    });
    await h.service.checkNow();
    expect(h.notices[0]!.title).toBe("ASX alert · NMR");
    expect(h.service.getSnapshot().status.lastError).toBeNull();
  });

  test("clearing the alerts empties and saves the history", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - 10 * MIN)], () => [halt("NMR", START - 1000)]);
    await h.service.checkNow();
    h.service.clearHistory();
    expect(h.service.getSnapshot().history).toEqual([]);
    expect(h.stored.get("au-alerts:history")).toEqual([]);
  });

  test("R checks now, and a second press while checking joins the same check", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - MIN)]);
    await h.service.tick();
    h.advance(5 * MIN);
    await Promise.all([h.service.checkNow(), h.service.checkNow()]);
    expect(h.requests).toHaveLength(2);
  });

  test("up to three alerts notify one by one; more come as one summary", async () => {
    let items: AsxAnnouncement[] = [halt("AAA", START - 1000), halt("BBB", START - 2000)];
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - 10 * MIN)], () => items);
    await h.service.checkNow();
    expect(h.notices.map((notice) => notice.title)).toEqual(["ASX alert · AAA", "ASX alert · BBB"]);
    expect(h.notices[0]!.body).toBe("Trading halt: Trading Halt");

    h.advance(5 * MIN);
    items = ["CCC", "DDD", "EEE", "FFF", "GGG"].map((code, index) => halt(code, h.now - index * 1000));
    await h.service.checkNow();
    expect(h.notices).toHaveLength(3);
    expect(h.notices[2]!.title).toBe("5 ASX alerts");
    expect(h.notices[2]!.body).toBe("CCC Trading halt, DDD Trading halt, EEE Trading halt, FFF Trading halt and 1 more");
  });

  test("alerts are kept newest first, capped, and the feed position is saved", async () => {
    const items = Array.from({ length: MAX_HISTORY + 5 }, (_, index) => halt(`C${index}`, START - index * 1000));
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - 60 * MIN)], () => items);
    await h.service.checkNow();
    const history = h.service.getSnapshot().history;
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0]!.code).toBe("C0");
    expect(h.stored.size).toBe(2);
  });

  test("a check that throws still waits the full interval before the next", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - MIN)]);
    const broken = createAlertService({
      readRules: () => { throw new Error("config unreadable"); },
      readIntervalMinutes: () => 60,
      persistence: { getState: () => null, setState: () => {} },
      notify: () => {}, openAlert: () => {}, openPane: () => {},
      fetchPage: async () => [], loadDividend: async () => { throw new Error("unused"); }, watchedCodes: async () => new Set(),
      now: () => h.now,
    });
    await broken.checkNow();
    expect(broken.getSnapshot().status).toMatchObject({ lastCheckAt: START, lastError: "config unreadable" });
  });

  test("a failed check is reported in the status, not as a notification", async () => {
    const h = harness([createRule({ event: "halt", scope: "market" }, [], START - MIN)], () => { throw new Error("HTTP 503"); });
    await h.service.checkNow();
    expect(h.notices).toEqual([]);
    expect(h.service.getSnapshot().status.lastError).toBe("ASX announcements: HTTP 503");
  });
});
