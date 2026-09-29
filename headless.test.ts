import { describe, expect, test } from "bun:test";
import type { HeadlessPaneContext, HeadlessPaneLoadArgs, HeadlessRowsResult } from "gloomberb/types/plugin";
import type { Headline } from "./types";

// `./config` is deliberately not stubbed: with no plugin context attached it
// already returns the declared defaults, which is what these assert against.
// Stubbing it partially here also broke capability.test.ts, because Bun shares
// one module registry across test files.
const { createNewsmapHeadless, projectNewsmapRows } = await import("./headless");

const HOUR = 3_600_000;
const now = Date.now();

function story(section: string, rank: number, cluster: number, title: string): Headline {
  return {
    id: `${section}:${rank}`, title, url: `https://news.google.com/rss/articles/${section}-${rank}`,
    source: "Reuters", publishedAt: now - rank * HOUR, section, rank, relatedCount: cluster,
  };
}

const FEED = [
  story("WORLD", 2, 0, "Third story"),
  story("BUSINESS", 0, 5, "Heaviest story"),
  story("NATION", 1, 1, "Middle story"),
];

let requested: { sections: readonly string[]; edition: string; force: boolean } | null = null;
function headless(feed: Headline[] = FEED, failedSections: string[] = []) {
  return createNewsmapHeadless({
    load: async (sections, edition, options) => {
      requested = { sections, edition, force: options.force };
      return { headlines: feed, failedSections, fetchedAt: now, stale: false };
    },
  });
}

function args(overrides: Partial<HeadlessPaneLoadArgs> = {}): HeadlessPaneLoadArgs {
  return { rawArgument: "", argument: null, symbols: [], options: {}, ...overrides };
}

const ctx = (settings?: Record<string, unknown>, refresh = false) =>
  ({ settings, refresh, signal: AbortSignal.timeout(5_000) } as unknown as HeadlessPaneContext);

describe("projectNewsmapRows", () => {
  test("ranks by weight and numbers from one", () => {
    const result = projectNewsmapRows(FEED, now, 10);
    expect(result.rows.map((row) => row.title)).toEqual(["Heaviest story", "Middle story", "Third story"]);
    expect(result.rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  test("carries machine-readable companions to the display columns", () => {
    const [row] = projectNewsmapRows(FEED, now, 1).rows;
    // "3h" is for reading; a script needs the URL and a real timestamp.
    expect(row!.url).toBe("https://news.google.com/rss/articles/BUSINESS-0");
    expect(() => new Date(row!.publishedAt as string).toISOString()).not.toThrow();
    expect(typeof row!.weight).toBe("number");
    expect(row!.outlets).toBe(6);
  });

  test("declares a column for every display field", () => {
    const result = projectNewsmapRows(FEED, now, 10);
    for (const column of result.columns ?? []) {
      expect(result.rows[0]).toHaveProperty(column.key);
    }
  });

  test("drops a story carried by two sections", () => {
    const duplicated = [...FEED, story("NATION", 4, 0, "Heaviest story")];
    expect(projectNewsmapRows(duplicated, now, 10).rows).toHaveLength(FEED.length);
  });

  test("honours the limit", () => {
    expect(projectNewsmapRows(FEED, now, 2).rows).toHaveLength(2);
  });
});

describe("resolution", () => {
  test("the argument wins over the option, the setting and the default", async () => {
    await headless().load(args({ argument: "JP", options: { edition: "US" } }), ctx({ edition: "FR" }));
    expect(requested!.edition).toBe("JP");
  });

  test("then the option, then the pane setting, then the configured default", async () => {
    await headless().load(args({ options: { edition: "US" } }), ctx({ edition: "FR" }));
    expect(requested!.edition).toBe("US");
    await headless().load(args(), ctx({ edition: "FR" }));
    expect(requested!.edition).toBe("FR");
    await headless().load(args(), ctx());
    expect(requested!.edition).toBe("AU");
  });

  test("an unknown edition falls back rather than building a bad URL", async () => {
    await headless().load(args({ argument: "Atlantis" }), ctx());
    expect(requested!.edition).toBe("AU");
  });

  test("sections come from the option, the setting, or the defaults", async () => {
    await headless().load(args({ options: { sections: "world, business" } }), ctx());
    expect(requested!.sections).toEqual(["WORLD", "BUSINESS"]);
    await headless().load(args({ options: { sections: "quidditch" } }), ctx());
    expect(requested!.sections.length).toBeGreaterThan(1);
    await headless().load(args(), ctx({ sections: ["TECHNOLOGY"] }));
    expect(requested!.sections).toEqual(["TECHNOLOGY"]);
  });

  test("only --refresh asks for the network", async () => {
    await headless().load(args(), ctx());
    expect(requested!.force).toBe(false);
    await headless().load(args(), ctx(undefined, true));
    expect(requested!.force).toBe(true);
  });

  test("a bad limit falls back instead of returning nothing", async () => {
    const many = Array.from({ length: 40 }, (_, index) => story("WORLD", index, 0, `Story ${index}`));
    for (const limit of [0, -3, Number.NaN, "lots"]) {
      const result = await headless(many).load(args({ options: { limit } as never }), ctx()) as HeadlessRowsResult;
      expect(result.rows.length).toBe(25);
    }
  });
});

describe("partial results", () => {
  test("a board missing a section is printed but not claimed to be complete", async () => {
    const result = await headless(FEED, ["TECHNOLOGY"]).load(args(), ctx()) as HeadlessRowsResult;
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
    expect(result.errors?.[0]).toContain("Tech");
  });

  test("a whole board reports complete with no errors", async () => {
    const result = await headless().load(args(), ctx()) as HeadlessRowsResult;
    expect(result.complete).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.metadata).toMatchObject({ edition: "AU", editionLabel: "Australia" });
  });
});

describe("describe", () => {
  test("names the edition the run will actually use", () => {
    const definition = headless();
    const describe_ = definition.describe as (input: HeadlessPaneLoadArgs) => string;
    expect(describe_(args({ argument: "JP" }))).toBe("World news · Japan");
    expect(describe_(args())).toBe("World news · Australia");
  });
});
