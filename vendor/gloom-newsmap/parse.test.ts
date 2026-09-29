import { describe, expect, test } from "bun:test";
import { decodeEntities, feedUrl, parseGoogleNewsFeed } from "./parse";
import { DEFAULT_EDITION_ID } from "./types";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Top stories - Google News</title>
<item>
  <title>Treasury yields slip as traders weigh the Fed&#39;s next move - Reuters</title>
  <link>https://news.google.com/rss/articles/AAA?oc=5</link>
  <pubDate>Tue, 29 Sep 2026 04:38:00 GMT</pubDate>
  <source url="https://www.reuters.com">Reuters</source>
  <description>&lt;ol&gt;&lt;li&gt;&lt;a href="x"&gt;Treasury yields slip&lt;/a&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="y"&gt;Bonds rally&lt;/a&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="z"&gt;Fed watch&lt;/a&gt;&lt;/li&gt;&lt;/ol&gt;</description>
</item>
<item>
  <title>A quiet story nobody else picked up - ABC News &amp; Headlines</title>
  <link>https://news.google.com/rss/articles/BBB?oc=5</link>
  <pubDate>Tue, 29 Sep 2026 01:10:00 GMT</pubDate>
  <source url="https://local.example">ABC News &amp; Headlines</source>
</item>
<item>
  <title>Broken item with no link</title>
  <pubDate>Tue, 29 Sep 2026 01:10:00 GMT</pubDate>
</item>
</channel></rss>`;

describe("feedUrl", () => {
  test("uses the edition front page for TOP and a topic path otherwise", () => {
    expect(feedUrl("TOP", "AU")).toBe("https://news.google.com/rss?hl=en-AU&gl=AU&ceid=AU%3Aen");
    expect(feedUrl("BUSINESS", "AU")).toBe(
      "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-AU&gl=AU&ceid=AU%3Aen",
    );
  });

  test("falls back to the default edition for an unknown id", () => {
    expect(feedUrl("TOP", "ZZ")).toBe(feedUrl("TOP", DEFAULT_EDITION_ID));
  });
});

describe("decodeEntities", () => {
  test("decodes named, decimal and hex references", () => {
    expect(decodeEntities("a &amp; b &#39;c&#39; &#x2014; d")).toBe("a & b 'c' — d");
  });

  test("leaves an unknown entity alone rather than eating it", () => {
    expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
  });
});

describe("parseGoogleNewsFeed", () => {
  const headlines = parseGoogleNewsFeed(FIXTURE, "TOP");

  test("skips items with no usable link", () => {
    expect(headlines).toHaveLength(2);
  });

  test("strips the trailing publisher and decodes entities in the title", () => {
    expect(headlines[0]!.title).toBe("Treasury yields slip as traders weigh the Fed's next move");
    expect(headlines[0]!.source).toBe("Reuters");
  });

  test("strips a publisher whose own name contains an entity", () => {
    expect(headlines[1]!.source).toBe("ABC News & Headlines");
    expect(headlines[1]!.title).toBe("A quiet story nobody else picked up");
  });

  test("ranks by feed position", () => {
    expect(headlines.map((h) => h.rank)).toEqual([0, 1]);
  });

  test("counts the cluster without counting the story itself", () => {
    expect(headlines[0]!.relatedCount).toBe(2);
    expect(headlines[1]!.relatedCount).toBe(0);
  });

  test("parses pubDate and scopes the id to the section", () => {
    expect(headlines[0]!.publishedAt).toBe(Date.parse("Tue, 29 Sep 2026 04:38:00 GMT"));
    expect(headlines[0]!.id).toBe("TOP:https://news.google.com/rss/articles/AAA?oc=5");
  });
});

describe("malformed and unusual feeds", () => {
  const item = (body: string) => `<rss><channel>${body}</channel></rss>`;

  test("an out-of-range character reference is left alone, not thrown on", () => {
    // String.fromCodePoint raises past U+10FFFF, and one bad character in one
    // item used to reject the whole section's feed.
    expect(() => decodeEntities("&#x110000;")).not.toThrow();
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
  });

  test("a surrogate half is left alone rather than emitted", () => {
    expect(decodeEntities("&#55296;")).toBe("&#55296;");
  });

  test("a decimal reference containing hex digits is not misread", () => {
    expect(decodeEntities("&#1e5;")).toBe("&#1e5;");
  });

  test("items with attributes or whitespace still parse", () => {
    const parsed = parseGoogleNewsFeed(
      item('<item ><title>A</title><link>https://a/1</link></item>'
         + '<item xmlns:x="y"><title>B</title><link>https://a/2</link></item>'),
      "TOP",
    );
    expect(parsed.map((h) => h.title)).toEqual(["A", "B"]);
  });

  test("a nested item does not pair the outer title with the inner link", () => {
    const parsed = parseGoogleNewsFeed(
      item("<item><title>Outer</title><item><title>Inner</title><link>https://a/in</link></item>"
         + "<link>https://a/out</link></item>"),
      "TOP",
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe("Outer");
    expect(parsed[0]!.url).toBe("https://a/out");
  });

  test("CDATA containing a close tag is not cut short", () => {
    const parsed = parseGoogleNewsFeed(
      item("<item><title><![CDATA[How to write </title> tags]]></title>"
         + "<link>https://a/1</link></item>"),
      "TOP",
    );
    expect(parsed[0]!.title).toBe("How to write </title> tags");
  });

  test("escaped list markup in description text is not counted as a cluster", () => {
    const parsed = parseGoogleNewsFeed(
      item("<item><title>T</title><link>https://a/1</link>"
         + "<description>&amp;lt;li&amp;gt;&amp;lt;li&amp;gt;&amp;lt;li&amp;gt;</description></item>"),
      "TOP",
    );
    expect(parsed[0]!.relatedCount).toBe(0);
  });

  test("a title that is only its publisher keeps something to draw", () => {
    const parsed = parseGoogleNewsFeed(
      item("<item><title> - Reuters</title><link>https://a/1</link>"
         + "<source url=\"https://reuters.com\">Reuters</source></item>"),
      "TOP",
    );
    expect(parsed[0]!.title.length).toBeGreaterThan(0);
  });

  test("items missing pubDate or source still parse", () => {
    const parsed = parseGoogleNewsFeed(
      item("<item><title>Bare</title><link>https://a/1</link></item>"),
      "TOP",
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.source).toBe("");
    expect(Number.isFinite(parsed[0]!.publishedAt)).toBe(true);
  });

  test("a headline ending in ' - Something' that is not the publisher is left alone", () => {
    const parsed = parseGoogleNewsFeed(
      item("<item><title>Nintendo Direct - September 2026</title><link>https://a/1</link>"
         + "<source url=\"https://ign.com\">IGN</source></item>"),
      "TOP",
    );
    expect(parsed[0]!.title).toBe("Nintendo Direct - September 2026");
  });
});
