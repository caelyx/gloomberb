import { describe, expect, test } from "bun:test";
import {
  contrastRatio, dedupeHeadlines, formatAge, freshness, mixHex, storyWeight,
  tileBudget, tileColor, tileLines, tileTextColor, topStories, wrapToWidth, type TilePalette,
} from "./model";
import { sectionHue, SECTION_IDS } from "./types";
import type { Headline } from "./types";

const DARK: TilePalette = {
  bg: "#0d1117", text: "#c9d1d9", textBright: "#ffffff",
  selected: "#1f6feb", selectedText: "#ffffff",
};
const LIGHT: TilePalette = {
  bg: "#ffffff", text: "#24292f", textBright: "#000000",
  selected: "#0969da", selectedText: "#ffffff",
};

function headline(overrides: Partial<Headline> = {}): Headline {
  return {
    id: "TOP:x", title: "A headline", url: "https://example.test/a",
    source: "Reuters", publishedAt: 0, section: "TOP", rank: 0, relatedCount: 0,
    ...overrides,
  };
}

describe("storyWeight", () => {
  test("falls off down the feed", () => {
    const weights = [0, 1, 2, 10, 30].map((rank) => storyWeight(headline({ rank })));
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]!).toBeLessThan(weights[i - 1]!);
    }
  });

  test("a widely carried story outranks the one above it", () => {
    expect(storyWeight(headline({ rank: 1, relatedCount: 5 })))
      .toBeGreaterThan(storyWeight(headline({ rank: 0, relatedCount: 0 })));
  });

  test("saturates at Google's five-article cap", () => {
    expect(storyWeight(headline({ relatedCount: 9 })))
      .toBe(storyWeight(headline({ relatedCount: 5 })));
  });

  test("is always positive, so no story collapses to a zero-area tile", () => {
    expect(storyWeight(headline({ rank: 500 }))).toBeGreaterThan(0);
  });
});

describe("freshness", () => {
  const now = 1_000_000_000_000;
  const hour = 3_600_000;

  test("is 1 for a story published now or in the future", () => {
    expect(freshness(now, now)).toBe(1);
    expect(freshness(now + hour, now)).toBe(1);
  });

  test("halves every six hours", () => {
    expect(freshness(now - 6 * hour, now)).toBeCloseTo(0.5, 5);
    expect(freshness(now - 12 * hour, now)).toBeCloseTo(0.25, 5);
  });

  test("stays in range for an ancient story", () => {
    expect(freshness(now - 400 * hour, now)).toBeGreaterThanOrEqual(0);
    expect(freshness(now - 400 * hour, now)).toBeLessThan(0.01);
  });
});

describe("tileColor", () => {
  test("a newer story sits further from the background than an older one", () => {
    const fresh = tileColor(sectionHue("BUSINESS"), 1, DARK);
    const stale = tileColor(sectionHue("BUSINESS"), 0, DARK);
    expect(fresh).not.toBe(stale);
    expect(contrastRatio(fresh, DARK.bg)).toBeGreaterThan(contrastRatio(stale, DARK.bg));
  });

  test("sections stay distinguishable at the same age", () => {
    const colours = new Set(SECTION_IDS.map((section) => tileColor(sectionHue(section), 0.8, DARK)));
    expect(colours.size).toBe(SECTION_IDS.length);
  });
});

describe("tileTextColor", () => {
  // Tile backgrounds come from the data, so the readable-text guarantee has to
  // hold for every section at every age, on either theme.
  test("clears 4.5:1 against every tile colour it can produce", () => {
    for (const palette of [DARK, LIGHT]) {
      for (const section of SECTION_IDS) {
        for (const age of [0, 0.25, 0.5, 0.75, 1]) {
          const background = tileColor(sectionHue(section), age, palette);
          expect(contrastRatio(tileTextColor(background, palette), background))
            .toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("mixHex", () => {
  test("returns the endpoints and the midpoint", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("accepts shorthand and clamps out-of-range ratios", () => {
    expect(mixHex("#000", "#fff", 2)).toBe("#ffffff");
    expect(mixHex("#000", "#fff", -1)).toBe("#000000");
  });
});

describe("wrapToWidth", () => {
  test("breaks on spaces within the width", () => {
    expect(wrapToWidth("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
  });

  test("breaks a word that is wider than the tile instead of dropping it", () => {
    expect(wrapToWidth("supercalifragilistic", 7)).toEqual(["superca", "lifragi", "listic"]);
  });

  test("returns nothing for a zero-width tile", () => {
    expect(wrapToWidth("anything", 0)).toEqual([]);
  });
});

describe("formatAge", () => {
  test("uses the largest unit that fits", () => {
    expect(formatAge(30_000)).toBe("now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(50 * 3_600_000)).toBe("2d");
  });
});

describe("tileLines", () => {
  const now = 10 * 3_600_000;
  const story = headline({ title: "Treasury yields slip as traders weigh the next move", publishedAt: now - 7_200_000 });

  test("marks a one-row tile as cut rather than letting it read as complete", () => {
    const lines = tileLines(story, 12, 1, now);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Treasury\u2026");
  });

  test("spends the last spare row on the source and age", () => {
    const lines = tileLines(story, 20, 6, now);
    expect(lines.at(-1)).toBe("Reuters · 2h");
    expect(lines.length).toBeLessThanOrEqual(6);
  });

  test("keeps the headline when there is no spare row for the meta line", () => {
    const lines = tileLines(story, 12, 2, now);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => !line.includes("·"))).toBe(true);
  });

  test("draws nothing on a tile too narrow to hold a word", () => {
    expect(tileLines(story, 3, 4, now)).toEqual([]);
  });

  test("never returns more lines than the tile is tall", () => {
    for (let height = 1; height <= 8; height += 1) {
      expect(tileLines(story, 16, height, now).length).toBeLessThanOrEqual(height);
    }
  });
});

describe("tileBudget", () => {
  test("scales with the pane and stays inside its bounds", () => {
    expect(tileBudget(118, 30)).toBeGreaterThan(tileBudget(60, 20));
    expect(tileBudget(400, 200)).toBe(120);
  });

  test("gives a cramped pane few big tiles rather than many unreadable ones", () => {
    // 40x12 used to be forced to eight ~9-cell-wide tiles, which cannot hold a
    // word; the geometry floor keeps each tile wide enough for a headline.
    const tiny = tileBudget(40, 12);
    expect(tiny).toBeLessThanOrEqual(Math.floor((40 * 12) / (13 * 4)));
    expect(tiny).toBeGreaterThanOrEqual(1);
    expect(tileBudget(0, 0)).toBe(1);
    expect(tileBudget(Number.NaN, 30)).toBe(1);
  });
});

describe("topStories", () => {
  test("returns everything when the board fits", () => {
    const all = [headline({ id: "a" }), headline({ id: "b" })];
    expect(topStories(all, 10)).toHaveLength(2);
  });

  test("keeps the heaviest and thins every section alike", () => {
    const stories = ["WORLD", "SPORTS", "BUSINESS"].flatMap((section) =>
      [0, 1, 2, 3].map((rank) => headline({ id: `${section}:${rank}`, section, rank })));
    const kept = topStories(stories, 6);
    expect(kept).toHaveLength(6);
    // Two per section: the rank-0 and rank-1 stories, never four of one.
    for (const section of ["WORLD", "SPORTS", "BUSINESS"]) {
      expect(kept.filter((story) => story.section === section)).toHaveLength(2);
    }
  });
});

describe("dedupeHeadlines", () => {
  test("keeps one copy of a story carried by two sections, the better-ranked one", () => {
    const business = headline({ id: "BUSINESS:x", section: "BUSINESS", rank: 0, title: "RBA lifts rates" });
    const national = headline({ id: "NATION:x", section: "NATION", rank: 7, title: "RBA lifts rates" });
    const kept = dedupeHeadlines([national, business]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.section).toBe("BUSINESS");
  });

  test("matches across punctuation and case differences", () => {
    const kept = dedupeHeadlines([
      headline({ id: "a", title: "Fed's next move — what now?" }),
      headline({ id: "b", title: "Feds next move  what now", rank: 4 }),
    ]);
    expect(kept).toHaveLength(1);
  });

  test("leaves genuinely different stories alone", () => {
    expect(dedupeHeadlines([
      headline({ id: "a", title: "One thing happened" }),
      headline({ id: "b", title: "Another thing happened" }),
    ])).toHaveLength(2);
  });
});

describe("wrapToWidth hyphen handling", () => {
  test("breaks after a hyphen rather than mid-syllable", () => {
    expect(wrapToWidth("Two-year-old euthanised", 11)).toEqual(["Two-year-", "old", "euthanised"]);
  });

  test("still hard-breaks a long unhyphenated word", () => {
    expect(wrapToWidth("antidisestablishmentarianism", 10)).toEqual([
      "antidisest", "ablishment", "arianism",
    ]);
  });
});

describe("density", () => {
  const pane = [100, 30] as const;

  test("moves how much pane a story gets", () => {
    const sparse = tileBudget(...pane, "sparse");
    const normal = tileBudget(...pane, "normal");
    const dense = tileBudget(...pane, "dense");
    expect(sparse).toBeLessThan(normal);
    expect(normal).toBeLessThan(dense);
  });

  test("defaults to normal, including for an unknown value", () => {
    expect(tileBudget(...pane)).toBe(tileBudget(...pane, "normal"));
    expect(tileBudget(...pane, "enormous" as never)).toBe(tileBudget(...pane, "normal"));
  });

  test("dense still cannot produce a tile too small to hold a headline", () => {
    // The readability floor is geometry, not preference: "dense" means as many
    // headlines as stay readable, never more than that.
    for (const [width, height] of [[40, 12], [60, 14], [100, 30]] as const) {
      const ceiling = Math.floor((width * height) / (13 * 4));
      expect(tileBudget(width, height, "dense")).toBeLessThanOrEqual(ceiling);
    }
  });

  test("a pane with room for only one readable tile gives one at every density", () => {
    for (const option of ["sparse", "normal", "dense"] as const) {
      expect(tileBudget(16, 5, option)).toBe(1);
    }
  });

  test("no density ever asks for more tiles than the pane can hold readably", () => {
    // The floor is a guarantee, not an active constraint: every shipped density
    // already sits above it. This is what stops a future retune from quietly
    // reintroducing the shredded-fragment board.
    for (const [width, height] of [[40, 12], [60, 14], [88, 16], [118, 34], [200, 60]] as const) {
      for (const option of ["sparse", "normal", "dense"] as const) {
        const ceiling = Math.max(1, Math.floor((width * height) / (13 * 4)));
        expect(tileBudget(width, height, option)).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});
