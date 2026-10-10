import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/ib-futures.json";
import { ibSnapshotCodec, ibStripCodec, loadRbap } from "./client";
import { parseIbFutures } from "./model";

describe("disk codecs", () => {
  test("the strip survives a round trip, nulls included", () => {
    const strip = parseIbFutures(fixture);
    expect(ibStripCodec.decode(JSON.parse(JSON.stringify(ibStripCodec.encode(strip))))).toEqual(strip);
  });

  test("a snapshot keeps month and settlement", () => {
    const snapshot = [{ month: "2026-10", settlement: 95.405 }, { month: "2026-11", settlement: 95.335 }];
    expect(ibSnapshotCodec.decode(ibSnapshotCodec.encode(snapshot))).toEqual(snapshot);
  });

  test("anything else is rejected, so a damaged copy is ignored rather than shown", () => {
    expect(() => ibStripCodec.decode({} as never)).toThrow();
    expect(() => ibStripCodec.decode(["2026-10-09", [["IBV2026", "2026-10", "95.4", null, null, null, null, 0]]] as never)).toThrow();
    expect(() => ibSnapshotCodec.decode([["2026-10", null]] as never)).toThrow();
  });
});

// The loader with its sources replaced: no network. Each test uses its own
// settlement dates, since the snapshot cache lives for the whole run.
function stripOn(settledOn: string, shift = 0) {
  const items = (fixture as { data: { items: Array<Record<string, unknown>> } }).data.items;
  return { data: { items: items.map((item) => ({ ...item, datePreviousSettlement: settledOn, pricePreviousSettlement: (item.pricePreviousSettlement as number) + shift })) } };
}

const f1Table = new Map([["FIRMMCRTD", { id: "FIRMMCRTD", title: "Cash rate target", units: "Per cent", points: [{ date: "2026-10-09", value: 4.6 }] }]]);
const f1Ok = async () => ({ data: f1Table, fetchedAt: 1_000, stale: false, source: "network" as const });
const f1Down = async (): Promise<never> => { throw new Error("rba.gov.au request failed (503)"); };

function sources(json: unknown, loadF1: typeof f1Ok | typeof f1Down = f1Ok) {
  return { fetchStrip: async () => json, loadF1 };
}

describe("loadRbap", () => {
  test("returns the parsed strip and F1, with no errors", async () => {
    const data = await loadRbap({ force: true }, sources(stripOn("2024-01-10")));
    expect(data.strip.settledOn).toBe("2024-01-10");
    expect(data.strip.contracts).toHaveLength(18);
    expect(data.f1).toBe(f1Table);
    expect(data.errors).toEqual([]);
    expect(data.meta?.stale).toBe(false);
  });

  test("F1 failing leaves the strip and says the path starts from the front contract", async () => {
    const data = await loadRbap({ force: true }, sources(stripOn("2024-05-10"), f1Down));
    expect(data.f1).toBeNull();
    expect(data.strip.contracts).toHaveLength(18);
    expect(data.errors).toEqual(["Cash rate unavailable, so the path starts from the front contract: rba.gov.au request failed (503)"]);
  });

  test("a response it does not recognise keeps the last strip, flagged stale with the reason", async () => {
    await loadRbap({ force: true }, sources(stripOn("2024-08-09")));
    const data = await loadRbap({ force: true }, sources({ error: { code: 400 } }));
    expect(data.strip.settledOn).toBe("2024-08-09");
    expect(data.meta).toMatchObject({ stale: true });
    expect(data.meta?.refreshError).toMatch(/not recognised/);
  });

  test("each settlement day is kept, and a later load finds it as a look-back within three days", async () => {
    await loadRbap({ force: true }, sources(stripOn("2025-03-03", 0.25)));
    // The day itself is never its own look-back.
    expect((await loadRbap({ force: true }, sources(stripOn("2025-03-03")))).lookbacks).toEqual([]);
    const week = await loadRbap({ force: true }, sources(stripOn("2025-03-10")));
    expect(week.lookbacks.map((entry) => [entry.label, entry.settledOn])).toEqual([["1W", "2025-03-03"]]);
    // The first copy of a day is kept: a second load that day does not overwrite it.
    expect(week.lookbacks[0]!.contracts[0]!.settlement).toBeCloseTo(95.405 + 0.25, 10);
    expect((await loadRbap({ force: true }, sources(stripOn("2025-03-08")))).lookbacks.map((entry) => entry.settledOn)).toEqual(["2025-03-03"]);
    expect((await loadRbap({ force: true }, sources(stripOn("2025-03-14")))).lookbacks.map((entry) => entry.label)).toEqual(["1W"]);
    expect((await loadRbap({ force: true }, sources(stripOn("2025-03-21")))).lookbacks.map((entry) => entry.settledOn)).toEqual(["2025-03-14"]);
  });

  test("without a settlement date nothing is kept or looked up", async () => {
    const undated = { data: { items: (fixture as { data: { items: Array<Record<string, unknown>> } }).data.items.map(({ datePreviousSettlement: _, ...item }) => item) } };
    const data = await loadRbap({ force: true }, sources(undated));
    expect(data.strip.settledOn).toBe("");
    expect(data.lookbacks).toEqual([]);
  });
});
