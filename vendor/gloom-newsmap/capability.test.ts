import { describe, expect, mock, test } from "bun:test";
import type { Headline } from "./types";

const HOUR = 3_600_000;
const now = Date.now();

function story(section: string, rank: number, cluster: number): Headline {
  return {
    id: `${section}:${rank}`, title: `${section} story ${rank}`,
    url: `https://example.test/${section}/${rank}`, source: "Reuters",
    publishedAt: now - rank * HOUR, section, rank, relatedCount: cluster,
  };
}

const FEED = [story("BUSINESS", 0, 5), story("BUSINESS", 3, 0), story("WORLD", 1, 2)];

/** Captures what sections the provider asked for, without touching Google. */
let requested: readonly string[] = [];
const loadFeed = mock(async (sections: readonly string[]) => {
  requested = sections;
  return { headlines: FEED, failedSections: [], fetchedAt: now, stale: false };
});
mock.module("./cache", () => ({ loadFeed, cachedFeed: () => null }));
// The real `./config` is used rather than a stub: it reads through a plugin
// context, so a fake context exercises the actual resolution instead of
// asserting against a second copy of it. (A partial stub here also leaks into
// other test files — Bun shares one module registry across the run.)
import { PROVIDER_SCOPE_CONFIG_KEY, setConfigContext } from "./config";

function useScope(scope: string | null) {
  setConfigContext({
    configState: { get: (key: string) => (key === PROVIDER_SCOPE_CONFIG_KEY ? scope : null) },
  } as never);
}

const { googleNewsCapability } = await import("./capability");

interface NewsScores {
  importance: number;
  urgency: number;
  marketImpact: number;
  novelty: number;
  confidence: number;
}
type ScoredArticle = { id: string; title: string; publishedAt: Date; scores: NewsScores };

/** The registry passes a handler context the provider does not read, so the
 * test calls the handler directly with the input shape alone. */
function invoke(op: string, query: unknown): unknown {
  const operation = googleNewsCapability.operations?.[op];
  if (!operation?.handler) throw new Error(`capability has no ${op} operation`);
  return (operation.handler as (input: unknown, ctx?: unknown) => unknown)({ query });
}

async function fetchArticles(query: unknown): Promise<ScoredArticle[]> {
  return await invoke("fetchNews", query) as ScoredArticle[];
}

describe("supports", () => {
  test("declines what it cannot honestly answer", () => {
    // Every article here is isBreaking: false and the host filters on it, so
    // claiming `breaking` would mean four round-trips to return nothing.
    for (const query of [
      { feed: "ticker" }, { ticker: "AAPL" }, { feed: "sector" },
      { feed: "breaking" }, { breaking: true },
    ]) {
      expect(invoke("supports", query)).toBe(false);
    }
  });

  test("accepts the general feeds it can serve", () => {
    for (const query of [{}, { feed: "latest" }, { feed: "top" }, { feed: "topic" }]) {
      expect(invoke("supports", query)).toBe(true);
    }
  });
});

describe("fetchNews", () => {
  test("resolves a topic given as a label, not just as a section id", async () => {
    // Articles are tagged with the label ("Business") while feeds are addressed
    // by id ("BUSINESS"), so a query echoing an article's own topic must work.
    await fetchArticles({ topics: ["Business"] });
    expect(requested).toEqual(["BUSINESS"]);

    await fetchArticles({ topics: ["TECHNOLOGY"] });
    expect(requested).toEqual(["TECHNOLOGY"]);
  });

  test("serves markets, not general news, when the query names no topic", async () => {
    // A beach closure is a fair tile in the heatmap and noise in a feed of
    // earnings calls, so the provider's default scope is narrower than the
    // pane's sections.
    await fetchArticles({});
    expect(requested).toEqual(["BUSINESS", "TECHNOLOGY"]);
    expect(requested).not.toContain("WORLD");
  });

  test("an unrecognised topic falls back to the configured scope", async () => {
    await fetchArticles({ topics: ["quidditch"] });
    expect(requested).toEqual(["BUSINESS", "TECHNOLOGY"]);
  });

  test("a query naming its sections gets them, whatever the scope", async () => {
    // The scope is a default for feeds asking for "the news", not a limit on
    // what the provider is willing to serve.
    await fetchArticles({ topics: ["World"] });
    expect(requested).toEqual(["WORLD"]);
  });

  test("the scope setting widens it to everything the pane shows", async () => {
    useScope("general");
    await fetchArticles({});
    expect(requested).toContain("WORLD");
    expect(requested).toContain("NATION");
    setConfigContext(null);
  });

  test("an unset or unknown scope falls back to markets", async () => {
    for (const scope of [null, "nonsense"]) {
      useScope(scope);
      await fetchArticles({});
      expect(requested).toEqual(["BUSINESS", "TECHNOLOGY"]);
    }
    setConfigContext(null);
  });

  test("returns well-formed articles, heaviest first", async () => {
    const articles = await fetchArticles({});
    expect(articles.length).toBe(FEED.length);
    expect(articles[0]!.title).toBe("BUSINESS story 0");
    expect(articles[0]!.publishedAt).toBeInstanceOf(Date);
    const scores = articles.map((article) => article.scores.importance);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test("reports recency as urgency, not a second copy of importance", async () => {
    const articles = await fetchArticles({});
    const fresh = articles.find((article) => article.id === "BUSINESS:0")!.scores;
    const old = articles.find((article) => article.id === "BUSINESS:3")!.scores;
    expect(fresh.urgency).toBeGreaterThan(old.urgency);
    expect(fresh.urgency).not.toBe(fresh.importance);
  });

  test("keeps every score inside 0..1", async () => {
    const articles = await fetchArticles({});
    for (const article of articles) {
      for (const value of Object.values(article.scores)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  test("ignores a zero or negative limit rather than returning nothing", async () => {
    expect((await fetchArticles({ limit: 0 })).length).toBe(FEED.length);
    expect((await fetchArticles({ limit: -5 })).length).toBe(FEED.length);
    expect((await fetchArticles({ limit: 2 })).length).toBe(2);
  });
});
