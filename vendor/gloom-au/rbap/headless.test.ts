import { describe, expect, test } from "bun:test";
import type { RbaSeries } from "../rba/model";
import fixture from "./fixtures/ib-futures.json";
import type { RbapLoad } from "./client";
import { createRbapHeadless } from "./headless";
import { parseIbFutures } from "./model";

const strip = parseIbFutures(fixture);
const series = (id: string, value: number): [string, RbaSeries] => [id, { id, title: id, units: "Per cent", points: [{ date: "2026-10-09", value }] }];
const f1 = new Map([series("FIRMMCRTD", 4.6), series("FIRMMCRID", 4.6)]);

function report(data: Partial<RbapLoad>) {
  const load = async (): Promise<RbapLoad> => ({ strip, f1, lookbacks: [], errors: [], meta: { fetchedAt: 0, stale: false }, ...data });
  return createRbapHeadless(load, () => "2026-10-10").load({} as never, { signal: new AbortController().signal } as never);
}

type Section = {
  title: string;
  rows?: Array<Record<string, unknown>>;
  entries?: Array<{ key: string; formatted?: string }>;
  columns?: Array<{ key: string; header: string; format?: (value: unknown) => string }>;
};

const sections = (result: { sections: unknown }) => result.sections as Section[];

describe("fn RBAP", () => {
  test("summary, path and contracts, with estimated dates marked", async () => {
    const result = await report({});
    const sections = result.sections as Section[];
    expect(sections.map((section) => section.title)).toEqual(["Summary", "Path", "Probabilities", "Contracts"]);
    const path = sections[1]!.rows!;
    expect(path[0]).toMatchObject({ meeting: "2026-11-03", estimated: false, odds: "29% hike" });
    expect(path.at(-1)).toMatchObject({ meeting: "~2028-03-21", estimated: true });
    expect(sections[0]!.entries!.find((entry) => entry.key === "end")?.formatted).toStartWith("~2028-03-21");
    expect(sections[3]!.rows).toHaveLength(18);
    expect(result.notes).toEqual(["~ Estimated meeting date: the RBA has not yet published that year's schedule."]);
    expect(result.freshness).toEqual({ asOf: "2026-10-09" });
    expect(result.complete).toBeUndefined();
  });

  test("probabilities: one column per 25 bp target level, the next meeting split either side of its implied level", async () => {
    const section = ((await report({})).sections as Section[]).find((entry) => entry.title === "Probabilities")!;
    const [meeting, current, hike] = section.columns!;
    expect(meeting!.header).toBe("Meeting");
    expect(current!.header).toBe("4.60%");
    expect(hike!.header).toBe("4.85%");
    const first = section.rows![0]!;
    expect(first.meeting).toBe("2026-11-03");
    expect(current!.format!(first[current!.key])).toBe("71.1%");
    expect(hike!.format!(first[hike!.key])).toBe("28.9%");
    // The same two-outcome reading as the Path tab's odds, to one more decimal place.
    expect(sections(await report({})).find((entry) => entry.title === "Path")!.rows![0]!.odds).toBe("29% hike");
    expect(section.rows!.at(-1)!.meeting).toBe("~2028-03-21");
  });

  test("no probabilities without F1: the front contract is not on the target's grid", async () => {
    const result = await report({ f1: null });
    expect((result.sections as Section[]).map((section) => section.title)).not.toContain("Probabilities");
  });

  test("F1 missing: the error, and the report marked incomplete", async () => {
    const result = await report({ f1: null, errors: ["Cash rate unavailable, so the path starts from the front contract: down"] });
    expect(result.errors).toEqual(["Cash rate unavailable, so the path starts from the front contract: down"]);
    expect(result.complete).toBe(false);
    const summary = (result.sections as Section[])[0]!.entries!;
    expect(summary.find((entry) => entry.key === "cashRate")?.formatted).toBe("— (path starts from the front contract)");
  });

  test("look-backs get a section only when there are some, and a failed refresh a note", async () => {
    const old = strip.contracts.map(({ month, settlement }) => ({ month, settlement: settlement + 0.1 }));
    const result = await report({ lookbacks: [{ label: "1W", settledOn: "2026-10-02", contracts: old }], meta: { fetchedAt: 0, stale: true, refreshError: "asx down" } });
    const lookbacks = (result.sections as Section[]).find((section) => section.title === "Look-backs");
    expect(lookbacks?.rows?.[0]).toMatchObject({ label: "1W", settledOn: "2026-10-02", date: "2026-11-03" });
    expect(lookbacks?.rows?.at(-1)).toMatchObject({ date: "~2028-03-21" });
    expect(result.notes).toContain("Refresh failed, showing the last copy: asx down");
  });
});
