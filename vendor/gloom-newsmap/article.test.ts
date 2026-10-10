import { describe, expect, test } from "bun:test";

import { extractArticle, isLocalNetworkUrl, looksMisdecoded, plainTextArticle } from "./article";

const fixture = await Bun.file(new URL("./fixtures/article.html", import.meta.url)).text();

/** Enough surrounding prose for Readability to accept the page as an article. */
function page(body: string): string {
  const filler = "<p>" + "The essay continues with a long and detailed paragraph about its subject. ".repeat(6) + "</p>";
  return `<html><body><article><h1>Title</h1>${filler}${body}${filler}</article></body></html>`;
}

describe("extractArticle", () => {
  test("keeps the article body as paragraphs", () => {
    const article = extractArticle(fixture);

    expect(article).not.toBeNull();
    expect(article!.paragraphs).toContain(
      "Because the bytecode is a flat list, you can print it with EXPLAIN and read it from top to bottom. Every loop, every comparison, and every jump is visible, and the output is the same on every machine that runs the same version of SQLite.",
    );
    expect(article!.paragraphs).toContain("Reading the plan");
    expect(article!.paragraphs).toContain("A flat program is easier to reason about than a tree of cooperating objects.");
  });

  test("decodes entities and keeps list items as their own paragraphs", () => {
    const article = extractArticle(fixture);

    expect(article!.paragraphs).toContain("The program can be paused after any instruction & resumed later.");
    expect(article!.paragraphs).toContain("Progress callbacks are cheap, because the loop already counts steps.");
  });

  test("drops navigation, the cookie banner, related links, and the footer", () => {
    const text = extractArticle(fixture)!.paragraphs.join("\n");

    expect(text).not.toContain("Subscribe to the newsletter");
    expect(text).not.toContain("We use cookies");
    expect(text).not.toContain("Related posts");
    expect(text).not.toContain("All rights reserved");
    expect(text).not.toContain("analytics");
  });

  test("does not repeat a paragraph nested inside another block", () => {
    const paragraphs = extractArticle(fixture)!.paragraphs;
    const quote = "A flat program is easier to reason about than a tree of cooperating objects.";

    expect(paragraphs.filter((paragraph) => paragraph.includes(quote))).toHaveLength(1);
  });

  test("keeps the line breaks of preformatted text", () => {
    const html = `<html><body><article><h1>Advisory</h1>
      <p>${"The advisory below was posted to the mailing list today and is reproduced in full. ".repeat(4)}</p>
      <pre>Package : openssl
CVE ID  : CVE-2026-0001

Details follow.</pre></article></body></html>`;

    expect(extractArticle(html)!.paragraphs).toContain("Package : openssl\nCVE ID  : CVE-2026-0001\n\nDetails follow.");
  });

  test("keeps text that sits beside a nested block", () => {
    const paragraphs = extractArticle(page("<ul><li>Fruits<ul><li>Apple</li><li>Pear</li></ul></li></ul>"))!.paragraphs;

    expect(paragraphs).toContain("Fruits");
    expect(paragraphs).toContain("Apple");
    expect(paragraphs).toContain("Pear");
  });

  test("keeps text placed directly in a div", () => {
    expect(extractArticle(page("<div>Loose text with no paragraph around it.</div>"))!.paragraphs)
      .toContain("Loose text with no paragraph around it.");
  });

  test("reads a table a row to a line", () => {
    const table = "<table><thead><tr><th>Make</th><th>Year</th><th>In-Tent</th></tr></thead>"
      + "<tbody><tr><td>Cadillac <b>Lyriq</b></td><td>2024</td><td>✓</td></tr><tr><td><p>Fiat</p></td><td></td><td>–</td></tr></tbody></table>";
    const paragraphs = extractArticle(page(table))!.paragraphs;

    expect(paragraphs).toContain("Make | Year | In-Tent");
    expect(paragraphs).toContain("Cadillac Lyriq | 2024 | ✓");
    expect(paragraphs).toContain("Fiat | | –");
    expect(paragraphs).not.toContain("2024");
  });

  test("reads a line break as a space and a double break as a new paragraph", () => {
    const paragraphs = extractArticle(page("<p>First line<br>same paragraph<br><br>Second paragraph</p>"))!.paragraphs;

    expect(paragraphs).toContain("First line same paragraph");
    expect(paragraphs).toContain("Second paragraph");
  });

  test("returns null for a page with no readable article", () => {
    expect(extractArticle("<html><head><title>App</title></head><body><div id=\"root\"></div><script>boot()</script></body></html>")).toBeNull();
  });
});

describe("plainTextArticle", () => {
  test("reflows hard-wrapped lines into one paragraph per block", () => {
    const text = "Network Working Group\r\nRequest for Comments: 2324\r\n\r\nThis document describes HTCPCP, a protocol for\ncontrolling, monitoring, and diagnosing coffee pots.\n\n\n";

    expect(plainTextArticle(text)!.paragraphs).toEqual([
      "Network Working Group Request for Comments: 2324",
      "This document describes HTCPCP, a protocol for controlling, monitoring, and diagnosing coffee pots.",
    ]);
  });

  test("returns null for an empty body", () => {
    expect(plainTextArticle(" \n\n ")).toBeNull();
  });
});

describe("isLocalNetworkUrl", () => {
  test.each([
    "http://localhost:8080/admin",
    "http://printer.local/",
    "http://dev.localhost/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/router",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("refuses %s", (url) => {
    expect(isLocalNetworkUrl(url)).toBe(true);
  });

  test.each([
    "https://example.com/post",
    "https://172.32.0.1/",
    "https://8.8.8.8/",
    "https://[2606:4700::1111]/",
    "https://localhost.example.com/",
  ])("allows %s", (url) => {
    expect(isLocalNetworkUrl(url)).toBe(false);
  });
});

describe("looksMisdecoded", () => {
  test("flags text full of replacement characters", () => {
    expect(looksMisdecoded(["Caf\uFFFD cr\uFFFDme br\uFFFDl\uFFFDe, \uFFFDt\uFFFD \uFFFDl\uFFFDgant ".repeat(10)])).toBe(true);
  });

  test("tolerates the odd stray replacement character", () => {
    expect(looksMisdecoded(["A long, ordinary English article. ".repeat(200) + "\uFFFD"])).toBe(false);
  });
});

