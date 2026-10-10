import { describe, expect, test } from "bun:test";
import { parseAsicMediaReleases } from "./asic";

const fixture = await Bun.file(new URL("./fixtures/asic-media-releases.json", import.meta.url)).text();

describe("parseAsicMediaReleases", () => {
  test("reads headline, release number, link and summary", () => {
    const [first] = parseAsicMediaReleases(fixture);
    expect(first).toMatchObject({
      title: "Full Federal Court dismisses appeal by former auditor Reginald Lance Williams",
      url: "https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2026-releases/26-237mr-full-federal-court-dismisses-appeal-by-former-auditor-reginald-lance-williams",
      releaseNumber: "26-237MR",
      categories: ["26-237MR"],
    });
    expect(first!.summary).toStartWith("The Full Court of the Federal Court has dismissed");
  });

  test("reads the Sydney wall-clock time ASIC labels as UTC, either side of daylight saving", () => {
    const byNumber = new Map(parseAsicMediaReleases(fixture).map((item) => [item.releaseNumber, item.publishedAt.toISOString()]));
    // "2026-10-09T16:00:00Z" is 4:00 pm AEDT (UTC+11); the release was saved at 05:02 UTC.
    expect(byNumber.get("26-237MR")).toBe("2026-10-09T05:00:00.000Z");
    // "2026-09-18T16:45:00Z" is 4:45 pm AEST (UTC+10); the page says "18/09/2026 04:45 PM".
    expect(byNumber.get("26-220MR")).toBe("2026-09-18T06:45:00.000Z");
  });

  test("skips hidden and incomplete items and keeps titles without a release number", () => {
    const items = parseAsicMediaReleases(JSON.stringify([
      { name: "26-001MR Hidden", url: "/a", publishedDate: "2026-01-02T10:00:00Z", documentNumber: "26-001MR", robotsNofollowNoindex: true },
      { name: "No date", url: "/b" },
      { name: "", url: "/c", publishedDate: "2026-01-02T10:00:00Z" },
      { name: "ASIC statement on markets", url: "https://www.asic.gov.au/d", dateCreated: "2026-01-02T10:00:00" },
    ]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "ASIC statement on markets", url: "https://www.asic.gov.au/d", categories: [] });
    expect(items[0]!.publishedAt.toISOString()).toBe("2026-01-01T23:00:00.000Z");
  });

  test("a malformed release number keeps its own item and the rest", () => {
    const items = parseAsicMediaReleases(JSON.stringify([
      { name: "26-237MR( Odd number", url: "/a", publishedDate: "2026-01-02T10:00:00Z", documentNumber: "26-237MR(" },
      { name: "26-238MR Next release", url: "/b", publishedDate: "2026-01-02T10:00:00Z", documentNumber: "26-238MR" },
    ]));
    expect(items.map((item) => item.title)).toEqual(["Odd number", "Next release"]);
  });

  test("keeps only https links on ASIC's own hosts", () => {
    const at = { publishedDate: "2026-01-02T10:00:00Z" };
    const items = parseAsicMediaReleases(JSON.stringify([
      { name: "Relative", url: "/about/a", ...at },
      { name: "Download host", url: "https://download.asic.gov.au/media/b.pdf", ...at },
      { name: "Other host", url: "https://evil.example/x", ...at },
      { name: "Protocol-relative", url: "//evil.example/y", ...at },
      { name: "Script", url: "javascript:alert(1)", ...at },
      { name: "Plain http", url: "http://www.asic.gov.au/c", ...at },
      { name: "Look-alike", url: "https://www.asic.gov.au.evil.example/d", ...at },
    ]));
    expect(items.map((item) => item.url)).toEqual(["https://www.asic.gov.au/about/a", "https://download.asic.gov.au/media/b.pdf"]);
  });

  test("rejects a body that is not a release list", () => {
    expect(() => parseAsicMediaReleases("<html></html>")).toThrow();
    expect(() => parseAsicMediaReleases("{}")).toThrow();
  });
});
