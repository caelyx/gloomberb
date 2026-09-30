import { describe, expect, test } from "bun:test";
import predictive from "../../test/fixtures/predictive-cba.json";
import page0 from "../../test/fixtures/announcements-cba-page0.json";
import { AsxClient, AsxHttpError, AsxLookupError, AsxResponseError } from "./client";

function fakeTransport(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const path = new URL(url).pathname + new URL(url).search;
    const match = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    return match ? match[1]() : new Response("not found", { status: 404 });
  };
  return { transport, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("AsxClient", () => {
  test("lookupEntity resolves a code to its xid", async () => {
    const { transport, calls } = fakeTransport({ "/asx-research/1.0/search/predictive": () => json(predictive) });
    const client = new AsxClient({ transport });
    const entity = await client.lookupEntity("cba");
    expect(entity.xid).toBe("204245597");
    expect(calls[0]?.url).toContain("searchText=CBA");
  });

  test("lookupEntity sends an identifying user agent and asks for JSON", async () => {
    const { transport, calls } = fakeTransport({ "/asx-research/1.0/search/predictive": () => json(predictive) });
    await new AsxClient({ transport }).lookupEntity("CBA");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("user-agent")).toMatch(/^gloom-asx\/\d/);
    expect(headers.get("user-agent")).toContain("github.com/caelyx/gloom-asx");
    expect(headers.get("accept")).toContain("application/json");
  });

  test("lookupEntity throws a lookup error when the code is unknown", async () => {
    const { transport } = fakeTransport({ "/asx-research/1.0/search/predictive": () => json({ data: { items: [] } }) });
    await expect(new AsxClient({ transport }).lookupEntity("ZZZZ")).rejects.toBeInstanceOf(AsxLookupError);
  });

  test("fetchAnnouncementsPage requests the page and parses it", async () => {
    const { transport, calls } = fakeTransport({ "/asx-research/1.0/markets/announcements": () => json(page0) });
    const client = new AsxClient({ transport, itemsPerPage: 25 });
    const page = await client.fetchAnnouncementsPage("204245597", 1);
    expect(calls[0]?.url).toContain("entityXids[]=204245597&page=1&itemsPerPage=25");
    expect(page.items).toHaveLength(10);
    expect(page.page).toBe(1);
  });

  test("HTTP failures surface the status and URL", async () => {
    const { transport } = fakeTransport({ "/asx-research/1.0/markets/announcements": () => new Response("nope", { status: 403 }) });
    const client = new AsxClient({ transport, maxRetries: 0 });
    const error = await client.fetchAnnouncementsPage("1", 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AsxHttpError);
    expect((error as AsxHttpError).status).toBe(403);
    expect((error as AsxHttpError).message).toContain("403");
  });

  test("a list body that is not JSON fails with a readable error", async () => {
    const { transport } = fakeTransport({ "/asx-research/1.0/markets/announcements": () => new Response("<html>maintenance</html>", { status: 200 }) });
    const error = await new AsxClient({ transport }).fetchAnnouncementsPage("1", 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AsxResponseError);
    expect((error as Error).message).toContain("not JSON");
  });

  test("a server error on the list surfaces as AsxHttpError", async () => {
    const { transport, calls } = fakeTransport({ "/asx-research/1.0/markets/announcements": () => new Response("down", { status: 503 }) });
    const error = await new AsxClient({ transport, maxRetries: 0 }).fetchAnnouncementsPage("1", 0).catch((e: unknown) => e);
    expect((error as AsxHttpError).status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  test("fetchPdf returns the bytes", async () => {
    const { transport, calls } = fakeTransport({ "/apiman-gateway/ASX/asx-research/1.0/file/": () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }) });
    const bytes = await new AsxClient({ transport }).fetchPdf("2924-1");
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
    expect(new Headers(calls[0]?.init?.headers).get("accept")).toContain("application/pdf");
  });
});
