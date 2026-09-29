import { describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "gloomberb/test-support";
import predictive from "../../test/fixtures/predictive-cba.json";
import page0 from "../../test/fixtures/announcements-cba-page0.json";
import { AsxClient } from "./client";
import { createAsxCaches } from "./cache";
import { ExtractUnavailableError, type ExtractFailureReason } from "./extract-error";
import { AsxAnnouncementsService } from "./service";

function setup() {
  const calls: string[] = [];
  const pdf = new Uint8Array(await_bytes());
  const transport = async (url: string): Promise<Response> => {
    calls.push(url);
    if (url.includes("/search/predictive")) return new Response(JSON.stringify(predictive), { status: 200 });
    if (url.includes("/markets/announcements")) return new Response(JSON.stringify(page0), { status: 200 });
    if (url.includes("/file/")) return new Response(pdf, { status: 200 });
    return new Response("nope", { status: 404 });
  };
  const caches = createAsxCaches();
  caches.attach(new MemoryPluginPersistence());
  const service = new AsxAnnouncementsService(new AsxClient({ transport }), caches);
  return { service, calls };
}

let pdfBytes: ArrayBuffer | null = null;
function await_bytes(): ArrayBuffer {
  if (!pdfBytes) throw new Error("pdf not loaded");
  return pdfBytes;
}

describe("AsxAnnouncementsService", () => {
  test("first page: one lookup and one page fetch, then served from cache", async () => {
    pdfBytes = await Bun.file(new URL("../../test/fixtures/sample-announcement.pdf", import.meta.url)).arrayBuffer();
    const { service, calls } = setup();
    const first = await service.loadPage("CBA", 0);
    expect(first.data.items).toHaveLength(10);
    expect(calls.filter((u) => u.includes("predictive"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("announcements"))).toHaveLength(1);

    const second = await service.loadPage("CBA", 0);
    expect(second.source).toBe("cache");
    expect(calls).toHaveLength(2);

    await service.loadPage("CBA", 0, { force: true });
    expect(calls.filter((u) => u.includes("announcements"))).toHaveLength(2);
    // The xid is remembered across forced reloads: no second lookup.
    expect(calls.filter((u) => u.includes("predictive"))).toHaveLength(1);
  });

  test("extract: downloads the PDF once and caches the cleaned text", async () => {
    pdfBytes = await Bun.file(new URL("../../test/fixtures/sample-announcement.pdf", import.meta.url)).arrayBuffer();
    const { service, calls } = setup();
    const page = await service.loadPage("CBA", 0);
    const announcement = page.data.items[0]!;
    const extract = await service.loadExtract(announcement);
    expect(extract.data.text).toContain("Commonwealth Bank completes buy-back");
    expect(extract.data.text).not.toContain("For personal use only");
    expect(extract.data.totalPages).toBe(1);
    await service.loadExtract(announcement);
    expect(calls.filter((u) => u.includes("/file/"))).toHaveLength(1);
  });
});

describe("AsxAnnouncementsService extract failures", () => {
  const PDF_ROUTE = "/file/";

  function withPdf(respond: () => Response | Promise<Response>) {
    const calls: string[] = [];
    const transport = async (url: string): Promise<Response> => {
      calls.push(url);
      if (url.includes("/search/predictive")) return new Response(JSON.stringify(predictive), { status: 200 });
      if (url.includes("/markets/announcements")) return new Response(JSON.stringify(page0), { status: 200 });
      if (url.includes(PDF_ROUTE)) return respond();
      return new Response("nope", { status: 404 });
    };
    const caches = createAsxCaches();
    caches.attach(new MemoryPluginPersistence());
    const service = new AsxAnnouncementsService(new AsxClient({ transport, maxRetries: 0 }), caches);
    return { service, calls };
  }

  const junkPdf = () => new Response(new TextEncoder().encode("%PDF-1.4\nnot really a pdf\n%%EOF"), { status: 200 });
  const cases: Array<[string, () => Response | Promise<Response>, ExtractFailureReason]> = [
    ["HTTP 413", () => new Response("too big", { status: 413 }), "too-large"],
    ["the web proxy's size refusal", () => Promise.reject(new Error('Plugin request was refused (502). {"error":"The upstream response is too large."}')), "too-large"],
    ["HTTP 403", () => new Response("forbidden", { status: 403 }), "refused"],
    ["HTTP 404", () => new Response("missing", { status: 404 }), "not-found"],
    ["HTTP 503", () => new Response("down", { status: 503 }), "server"],
    ["a timeout", () => Promise.reject(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" })), "timeout"],
    ["a dropped connection", () => Promise.reject(new TypeError("Failed to fetch")), "network"],
    ["the web proxy refusing a signed-out session", () => Promise.reject(new Error('Plugin request was refused (401). {"error":"Sign in to use plugin requests."}')), "network"],
    ["an HTML body", () => new Response("<html>error</html>", { status: 200 }), "unreadable"],
    ["a malformed PDF", junkPdf, "unreadable"],
  ];

  for (const [label, respond, reason] of cases) {
    test(`${label}: the extract is unavailable, the announcement is not`, async () => {
      const { service, calls } = withPdf(respond);
      const page = await service.loadPage("CBA", 0);
      const announcement = page.data.items[0]!;
      const error = await service.loadExtract(announcement).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExtractUnavailableError);
      expect((error as ExtractUnavailableError).reason).toBe(reason);
      // The row and its link to the original PDF are untouched, and the list still loads from cache.
      expect(announcement.pdfUrl).toStartWith("https://cdn-api.markitdigital.com/");
      expect((await service.loadPage("CBA", 0)).data.items[0]).toEqual(announcement);
      // Nothing was cached, so a retry downloads again.
      await service.loadExtract(announcement).catch(() => undefined);
      expect(calls.filter((u) => u.includes(PDF_ROUTE))).toHaveLength(2);
    });
  }

  test("a failure on one announcement leaves the next one readable", async () => {
    const good = new Uint8Array(await Bun.file(new URL("../../test/fixtures/compressed-announcement.pdf", import.meta.url)).arrayBuffer());
    let first = true;
    const { service } = withPdf(() => {
      if (first) { first = false; return new Response("too big", { status: 413 }); }
      return new Response(good, { status: 200 });
    });
    const [a, b] = (await service.loadPage("CBA", 0)).data.items;
    await expect(service.loadExtract(a!)).rejects.toBeInstanceOf(ExtractUnavailableError);
    expect((await service.loadExtract(b!)).data.text).toContain("Compressed stream sample");
  });
});
