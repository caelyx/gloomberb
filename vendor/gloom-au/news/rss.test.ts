import { describe, expect, test } from "bun:test";
import { parseFeed } from "./rss";

describe("parseFeed", () => {
  test("reads RSS 2.0 items with CDATA descriptions and categories", () => {
    const items = parseFeed(`<rss version="2.0"><channel><item>
      <title>Mine moves towards construction</title>
      <link>https://www.abc.net.au/news/2026-10-08/a/1</link>
      <description><![CDATA[A <b>rare earths</b> mine &amp; more]]></description>
      <pubDate>Thu, 08 Oct 2026 07:10:55 +0000</pubDate>
      <category>Mining Industry</category>
    </item><item><title>No date</title><link>https://x</link></item></channel></rss>`);
    expect(items).toEqual([{
      title: "Mine moves towards construction",
      url: "https://www.abc.net.au/news/2026-10-08/a/1",
      publishedAt: new Date("2026-10-08T07:10:55Z"),
      summary: "A rare earths mine & more",
      categories: ["Mining Industry"],
    }]);
  });

  test("reads RSS 1.0/RDF items dated with dc:date, and rejects non-feeds", () => {
    const items = parseFeed(`<rdf:RDF><item rdf:about="https://www.rba.gov.au/media-releases/2026/mr-26-28.html">
      <title>Release of Financial Stability Review – October 2026</title>
      <dc:date>2026-10-01T11:30:00+10:00</dc:date></item></rdf:RDF>`);
    expect(items[0]).toMatchObject({
      url: "https://www.rba.gov.au/media-releases/2026/mr-26-28.html",
      publishedAt: new Date("2026-10-01T01:30:00Z"),
    });
    expect(() => parseFeed("<html></html>")).toThrow(/not recognised/);
  });
});
