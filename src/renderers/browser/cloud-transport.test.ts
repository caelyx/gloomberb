import { afterEach, describe, expect, test } from "bun:test";
import { apiClient, setCloudApiFetchTransport } from "../../api-client";
import { verifiedUser } from "../../test-support/cloud-api";
import { browserCredentialedFetch, restoreBrowserCloudSession } from "./cloud-transport";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  apiClient.dispose();
  setCloudApiFetchTransport(null);
  apiClient.setSessionToken(null);
  apiClient.restoreCachedUser(null);
  apiClient.setCookieSessionMode(false);
});

test("browser cloud transport uses host cookies without forwarding forbidden headers", async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = init;
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await browserCredentialedFetch("https://api.gloom.sh/auth/get-session", {
    headers: { Cookie: "must-not-leak", Origin: "https://api.gloom.sh", Accept: "application/json" },
  });
  const headers = new Headers(captured?.headers);
  expect(captured?.credentials).toBe("include");
  expect(headers.has("Cookie")).toBe(false);
  expect(headers.has("Origin")).toBe(false);
  expect(headers.get("Accept")).toBe("application/json");
});

test("browser cloud transport plants session cookies before dropping the Cookie header", async () => {
  const planted: string[] = [];
  const previousDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: { cookie: string } }).document = {
    get cookie() {
      return planted.join("; ");
    },
    set cookie(value: string) {
      planted.push(value);
    },
  };
  const previousLocation = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: { protocol: string } }).location = { protocol: "https:" };

  globalThis.fetch = (async () => {
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await browserCredentialedFetch("https://api.gloom.sh/auth/get-session", {
      headers: {
        Cookie: "__Secure-gloomberb.session_token=signed-token.value; gloomberb.session_token=signed-token.value",
      },
    });
    expect(planted).toEqual([
      "__Secure-gloomberb.session_token=signed-token.value; Path=/; SameSite=Lax; Secure",
      "gloomberb.session_token=signed-token.value; Path=/; SameSite=Lax; Secure",
    ]);
  } finally {
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = previousDocument;
    if (previousLocation === undefined) delete (globalThis as { location?: unknown }).location;
    else (globalThis as { location?: unknown }).location = previousLocation;
  }
});

// Downstream: a Gloom session is optional in the private web deployment, so
// startup has to settle, signed in or anonymous, whatever the session check does.
describe("optional Gloom session restore", () => {
  function restoreWith(respond: () => Response | Promise<Response>) {
    apiClient.setCookieSessionMode(true);
    setCloudApiFetchTransport((async () => respond()) as typeof fetch);
    const unexpected: unknown[] = [];
    return { unexpected, done: restoreBrowserCloudSession(200, (error) => unexpected.push(error)) };
  }

  test("no session: settles anonymously", async () => {
    const { unexpected, done } = restoreWith(() => Response.json({ message: "Unauthorized" }, { status: 401 }));
    await done;
    expect(apiClient.getCurrentUser()).toBeNull();
    expect(unexpected).toEqual([]);
  });

  test("valid session: restores the user", async () => {
    const { unexpected, done } = restoreWith(() => Response.json({ user: verifiedUser }));
    await done;
    expect(apiClient.getCurrentUser()?.id).toBe(verifiedUser.id);
    expect(unexpected).toEqual([]);
  });

  test("expired or revoked session: settles anonymously and drops the stale identity", async () => {
    apiClient.setSessionToken("stale-token.value");
    apiClient.restoreCachedUser(verifiedUser);
    const { unexpected, done } = restoreWith(() => Response.json({ code: "USER_NOT_FOUND" }, { status: 403 }));
    await done;
    expect(apiClient.getCurrentUser()).toBeNull();
    expect(unexpected).toEqual([]);
  });

  test.each([
    ["the API is unreachable", () => { throw new TypeError("Failed to fetch"); }],
    ["something in front of the API answers with HTML", () => new Response("<!doctype html><title>Sign in</title>")],
    ["the API never answers", () => new Promise<Response>(() => {})],
  ])("%s: settles without reporting", async (_case, respond) => {
    const { unexpected, done } = restoreWith(respond as () => Response);
    await done;
    expect(unexpected).toEqual([]);
  });

  test("an unexpected error still settles, but is reported rather than swallowed", async () => {
    const bug = new ReferenceError("somethingUndefined is not defined");
    const { unexpected, done } = restoreWith(() => { throw bug; });
    await done;
    expect(unexpected).toEqual([bug]);
  });
});
