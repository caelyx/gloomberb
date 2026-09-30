import { describe, expect, test } from "bun:test";
import { displayWidth, truncateToDisplayWidth } from "gloomberb/utils";
import { clipToWidth, tileLines, wrapToWidth } from "./model";
import type { Headline } from "./types";

/**
 * These are the cases model.test.ts cannot reach: they run the wrap against the
 * host's own width measurement, which is what the pane passes. The bug they
 * exist for was invisible to a code-point measure — the pane was deleting about
 * a third of every Japanese headline, because `truncateToDisplayWidth` appends
 * an ellipsis and so is not a prefix of its input.
 */

const LATIN = "antidisestablishmentarianism";
const JAPANESE = "新型コロナウイルス感染症対策本部会議を開催";

function story(overrides: Partial<Headline> = {}): Headline {
  return {
    id: "x", title: "A headline", url: "https://example.test/a", source: "Reuters",
    publishedAt: 0, section: "TOP", rank: 0, relatedCount: 0, ...overrides,
  };
}

describe("the host truncator is not a prefix", () => {
  test("which is the trap this module must not fall into", () => {
    // Guard on the host's behaviour: if this ever changes, the reasoning in
    // clipToWidth's comment needs revisiting.
    expect(truncateToDisplayWidth(LATIN, 10)).toBe("antidis...");
    expect(LATIN.startsWith(truncateToDisplayWidth(LATIN, 10))).toBe(false);
  });
});

describe("clipToWidth", () => {
  test("returns a real prefix, so a caller can advance past it", () => {
    for (const width of [1, 2, 5, 8, 13]) {
      for (const text of [LATIN, JAPANESE]) {
        const head = clipToWidth(text, width, displayWidth);
        expect(text.startsWith(head)).toBe(true);
        expect(displayWidth(head)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("never adds a marker", () => {
    expect(clipToWidth(LATIN, 10, displayWidth)).toBe("antidisest");
  });

  test("counts an East Asian glyph as two cells", () => {
    expect(clipToWidth(JAPANESE, 8, displayWidth)).toBe("新型コロ");
  });
});

describe("wrapToWidth under the host's measure", () => {
  test("loses nothing when it hard-breaks a long latin word", () => {
    const lines = wrapToWidth(LATIN, 10, displayWidth);
    expect(lines.join("")).toBe(LATIN);
  });

  test("loses nothing when it hard-breaks a CJK headline", () => {
    const lines = wrapToWidth(JAPANESE, 8, displayWidth);
    expect(lines.join("")).toBe(JAPANESE);
  });

  test("keeps every line inside the tile", () => {
    for (const width of [6, 8, 12, 20]) {
      for (const text of [LATIN, JAPANESE, "Central bank lifts rates as inflation cools"]) {
        for (const line of wrapToWidth(text, width, displayWidth)) {
          expect(displayWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("emits no ellipsis of its own — wrapping is not truncation", () => {
    expect(wrapToWidth(JAPANESE, 8, displayWidth).join("")).not.toContain("…");
    expect(wrapToWidth(LATIN, 10, displayWidth).join("")).not.toContain("...");
  });
});

describe("tileLines under the host's measure", () => {
  test("marks a headline that ran out of rows", () => {
    const lines = tileLines(story({ title: LATIN }), 10, 2, 0, displayWidth);
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toEndWith("…");
  });

  test("does not mark a headline that fitted", () => {
    const lines = tileLines(story({ title: "Rates held" }), 12, 4, 0, displayWidth);
    expect(lines.join("")).not.toContain("…");
  });

  test("drops a source too short to name an outlet, keeping the age", () => {
    // "Re… · 3h" says nothing; the bare age does.
    const lines = tileLines(story({ title: "Rates", source: "Reuters" }), 10, 4, 3 * 3_600_000, displayWidth);
    expect(lines.at(-1)).toBe("3h");
  });

  test("keeps the source when there is room for it", () => {
    const lines = tileLines(story({ title: "Rates", source: "Reuters" }), 20, 4, 3 * 3_600_000, displayWidth);
    expect(lines.at(-1)).toBe("Reuters · 3h");
  });

  test("never draws outside the tile", () => {
    for (const width of [6, 9, 14, 30]) {
      for (const height of [1, 2, 3, 6]) {
        const lines = tileLines(story({ title: JAPANESE }), width, height, 0, displayWidth);
        expect(lines.length).toBeLessThanOrEqual(height);
        for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
