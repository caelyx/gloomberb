import { describe, expect, test } from "bun:test";

import {
  buildBatchExecuteBody, isGoogleNewsArticleUrl, parseBatchExecuteResponse, parseDecodingParams,
} from "./resolve";

/** A Google News article page as served, cut down to the element the resolver reads. */
const articlePage = await Bun.file(new URL("./fixtures/google-article.html", import.meta.url)).text();
/** A real batchexecute answer for that article. */
const batchResponse = await Bun.file(new URL("./fixtures/batchexecute.txt", import.meta.url)).text();

const ARTICLE_ID = "CBMikAFBVV95cUxNSEZIZURSQXR4QjJhX0UwODNJY0haSXczQ1BRTW1BRGdPbHZ2X0xfbWJBRzRUZkpoQXBLS3E1Z0Znc0R1R2ktcXBSbnMzMkwxY1UtWW00U1VXWldsVmYwUU5senVEVVA0TW5JdXZtTWpTWDdpTDhCSzhTckEyLXFaMktuNjdhZjBuRlRjcXp3QWY";

describe("isGoogleNewsArticleUrl", () => {
  test.each([
    `https://news.google.com/rss/articles/${ARTICLE_ID}?oc=5`,
    `https://news.google.com/articles/${ARTICLE_ID}`,
  ])("recognises %s", (url) => {
    expect(isGoogleNewsArticleUrl(url)).toBe(true);
  });

  test.each([
    "https://www.abc.net.au/news/2026-10-02/story/107223576",
    "https://news.google.com/rss?hl=en-AU",
    "https://news.google.com.evil.example/rss/articles/X",
    "not a url",
  ])("leaves %s alone", (url) => {
    expect(isGoogleNewsArticleUrl(url)).toBe(false);
  });
});

describe("parseDecodingParams", () => {
  test("reads the id, timestamp and signature off the article page", () => {
    expect(parseDecodingParams(articlePage)).toEqual({
      id: ARTICLE_ID,
      timestamp: 1790936225,
      signature: "AbIaSL9ZE3DgRA33nWweoGx-MMz3",
    });
  });

  test("returns null when Google changes the page", () => {
    expect(parseDecodingParams("<html><body><div data-n-a-id=\"X\"></div></body></html>")).toBeNull();
  });
});

describe("buildBatchExecuteBody", () => {
  test("wraps the garturlreq call in an f.req form field", () => {
    const body = new URLSearchParams(buildBatchExecuteBody({ id: "ID", timestamp: 17, signature: "SIG" }));
    const [[[rpc, inner]]] = JSON.parse(body.get("f.req")!) as [[[string, string]]];
    const call = JSON.parse(inner) as unknown[];

    expect(rpc).toBe("Fbv4je");
    expect(call[0]).toBe("garturlreq");
    expect(call.slice(-3)).toEqual(["ID", 17, "SIG"]);
  });
});

describe("parseBatchExecuteResponse", () => {
  test("returns the publisher URL", () => {
    expect(parseBatchExecuteResponse(batchResponse))
      .toBe("https://www.abc.net.au/news/2026-10-02/indian-prime-talks-with-flydubai-pilot/107223576");
  });

  test("rejects an answer with no URL in it", () => {
    const empty = ")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",null,null,null,[3],\"generic\"],[\"di\",9]]";

    expect(() => parseBatchExecuteResponse(empty)).toThrow("Google News did not say where this story links to.");
  });

  test("rejects a URL that is not http(s)", () => {
    const script = batchResponse.replace(/https:\/\/www\.abc\.net\.au[^\\]*/, "javascript:alert(1)");

    expect(() => parseBatchExecuteResponse(script)).toThrow("Google News did not say where this story links to.");
  });

  test("rejects a body that is not a batchexecute answer", () => {
    expect(() => parseBatchExecuteResponse("<html>Sorry...</html>")).toThrow("Google News did not say where this story links to.");
  });
});
