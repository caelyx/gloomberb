import { describe, expect, test } from "bun:test";
import { handleHttpProxy, proxyPolicyFor, validateProxyTarget } from "./http-proxy";

const SESSION_COOKIE = "__Secure-gloomberb.session_token=abc123";

// The real allowlist is generated from what bundled plugins declare. These
// tests are about the guardrails, so they pin one example host.
const HOSTS = ["substack.com"];

function proxyRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://term.gloom.sh/http-proxy", {
    method: "POST",
    headers: { cookie: SESSION_COOKIE, ...(init.headers as Record<string, string> ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}

describe("proxy target validation", () => {
  test("allows an allowlisted host and its subdomains", () => {
    expect(validateProxyTarget("https://substack.com/api/v1/reader/feed", HOSTS)).toHaveProperty("url");
    expect(validateProxyTarget("https://example.substack.com/api/v1/posts", HOSTS)).toHaveProperty("url");
  });

  test("refuses a host that merely ends with an allowlisted name", () => {
    // "evilsubstack.com" ends with "substack.com" as a string but is a
    // different registrable domain, so suffix matching has to be on a label.
    expect(validateProxyTarget("https://evilsubstack.com/x", HOSTS)).toMatchObject({ status: 403 });
  });

  test.each([
    ["http://substack.com/x", "plain http"],
    ["https://user:pass@substack.com/x", "credentials in the URL"],
    ["https://substack.com:8443/x", "a non-default port"],
    ["https://169.254.169.254/latest/meta-data", "an IP literal"],
    ["https://localhost/x", "localhost"],
    ["https://api.github.com/x", "a host that is not allowlisted"],
  ])("refuses %s (%s)", (url) => {
    const result = validateProxyTarget(url, HOSTS);

    expect(result).not.toHaveProperty("url");
    expect((result as { status: number }).status).toBeGreaterThanOrEqual(400);
  });
});

describe("proxy request handling", () => {
  test("forwards only the envelope, never the caller's session cookie", async () => {
    // The browser attaches the Gloomberb session to this same-origin POST.
    // Passing it upstream would hand a third party the user's session.
    let seen: Request | undefined;
    const response = await handleHttpProxy(
      proxyRequest({
        url: "https://substack.com/api/v1/reader/feed",
        init: { headers: { cookie: "substack.sid=plugin-owned", "user-agent": "Gloomberb" } },
      }),
      (async (input: Request | string | URL, init?: RequestInit) => {
        seen = new Request(input as never, init);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
      HOSTS,
    );

    expect(response.status).toBe(200);
    expect(seen?.headers.get("cookie")).toBe("substack.sid=plugin-owned");
    expect(seen?.headers.get("cookie")).not.toContain("gloomberb.session_token");
    expect(seen?.headers.get("user-agent")).toBe("Gloomberb");
  });

  test("returns set-cookie in the envelope instead of as a header", async () => {
    // A real Set-Cookie here would let a third party set cookies on the
    // Gloomberb origin.
    const response = await handleHttpProxy(
      proxyRequest({ url: "https://substack.com/api/v1/login", init: { method: "POST", body: "{}" } }),
      (async () => new Response("{}", {
        status: 200,
        headers: { "set-cookie": "substack.sid=granted; Path=/; HttpOnly" },
      })) as typeof fetch,
      HOSTS,
    );
    const envelope = await response.json() as { setCookie: string[]; headers: Record<string, string> };

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(envelope.setCookie[0]).toContain("substack.sid=granted");
    expect(envelope.headers["set-cookie"]).toBeUndefined();
  });

  test("requires a session cookie", async () => {
    const response = await handleHttpProxy(
      new Request("https://term.gloom.sh/http-proxy", {
        method: "POST",
        body: JSON.stringify({ url: "https://substack.com/x" }),
      }),
      (async () => new Response("nope")) as typeof fetch,
      HOSTS,
    );

    expect(response.status).toBe(401);
  });

  test("refuses a cross-origin caller", async () => {
    const response = await handleHttpProxy(
      proxyRequest({ url: "https://substack.com/x" }, { headers: { origin: "https://evil.example" } }),
      (async () => new Response("nope")) as typeof fetch,
      HOSTS,
    );

    expect(response.status).toBe(403);
  });

  test("reports an upstream timeout as a gateway error rather than throwing", async () => {
    const response = await handleHttpProxy(
      proxyRequest({ url: "https://substack.com/slow" }),
      (async () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      }) as typeof fetch,
      HOSTS,
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("timed out") });
  });
});

// Downstream: the private deployment drops only the session requirement. Every
// test below runs with that policy, so each guardrail is shown to hold without
// the session check in front of it.
describe("private deployment policy", () => {
  const PRIVATE = proxyPolicyFor("true");
  const ORIGIN = "https://gloom.private.example";

  function privateRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(`${ORIGIN}/http-proxy`, {
      method: "POST",
      headers: { origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  }

  function recordingUpstream(respond: (url: string, init: RequestInit) => Response = () => new Response("[]")) {
    const seen: Request[] = [];
    const upstream = (async (input: Request | string | URL, init?: RequestInit) => {
      seen.push(new Request(input as never, init));
      return respond(String(input), init ?? {});
    }) as typeof fetch;
    return { seen, upstream };
  }

  test("only the exact string \"true\" drops the session requirement", () => {
    expect(proxyPolicyFor("true").requireSession).toBe(false);
    for (const ambiguous of [undefined, "", "false", "1", "yes", "TRUE", " true", true]) {
      expect(proxyPolicyFor(ambiguous).requireSession).toBe(true);
    }
  });

  test("allows a plugin request without a Gloom session", async () => {
    const { seen, upstream } = recordingUpstream();
    const response = await handleHttpProxy(privateRequest({ url: "https://substack.com/feed" }), upstream, HOSTS, PRIVATE);

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  test("requires the browser's same-origin Origin header", async () => {
    const { seen, upstream } = recordingUpstream();
    const missing = await handleHttpProxy(
      new Request(`${ORIGIN}/http-proxy`, { method: "POST", body: JSON.stringify({ url: "https://substack.com/x" }) }),
      upstream, HOSTS, PRIVATE,
    );
    const crossOrigin = await handleHttpProxy(
      privateRequest({ url: "https://substack.com/x" }, { origin: "https://evil.example" }),
      upstream, HOSTS, PRIVATE,
    );

    expect(missing.status).toBe(403);
    expect(crossOrigin.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  test.each([
    ["https://api.github.com/x", 403, "an unlisted host"],
    ["http://substack.com/x", 400, "plain http"],
    ["https://10.0.0.1/x", 403, "a private IP literal"],
    ["https://[::ffff:a9fe:a9fe]/x", 403, "an IPv6-mapped metadata address"],
    ["https://localhost/x", 403, "localhost"],
  ])("still refuses %s", async (url, status) => {
    const { seen, upstream } = recordingUpstream();
    const response = await handleHttpProxy(privateRequest({ url }), upstream, HOSTS, PRIVATE);

    expect(response.status).toBe(status);
    expect(seen).toHaveLength(0);
  });

  test("still refuses methods outside the proxy's set", async () => {
    const { seen, upstream } = recordingUpstream();
    const wrongOuter = await handleHttpProxy(
      new Request(`${ORIGIN}/http-proxy`, { method: "GET", headers: { origin: ORIGIN } }),
      upstream, HOSTS, PRIVATE,
    );
    const wrongInner = await handleHttpProxy(
      privateRequest({ url: "https://substack.com/x", init: { method: "TRACE" } }),
      upstream, HOSTS, PRIVATE,
    );

    expect(wrongOuter.status).toBe(405);
    expect(wrongInner.status).toBe(405);
    expect(seen).toHaveLength(0);
  });

  test("never forwards the Gloom session or Cloudflare Access credentials, even when a plugin sets them", async () => {
    const { seen, upstream } = recordingUpstream();
    await handleHttpProxy(
      privateRequest(
        {
          url: "https://substack.com/x",
          init: {
            headers: {
              cookie: "__Secure-gloomberb.session_token=leak; substack.sid=ok; gloomberb.session_token=leak; CF_Authorization=jwt",
              "cf-access-jwt-assertion": "jwt",
              "CF-Access-Client-Secret": "secret",
            },
          },
        },
        { cookie: "__Secure-gloomberb.session_token=caller; CF_Authorization=caller-jwt", "cf-access-jwt-assertion": "caller-jwt" },
      ),
      upstream, HOSTS, PRIVATE,
    );

    const sent = seen[0]!.headers;
    expect(sent.get("cookie")).toBe("substack.sid=ok");
    expect(sent.has("cf-access-jwt-assertion")).toBe(false);
    expect(sent.has("cf-access-client-secret")).toBe(false);
  });

  test("drops the Cookie header entirely when only origin credentials were in it", async () => {
    const { seen, upstream } = recordingUpstream();
    await handleHttpProxy(
      privateRequest({ url: "https://substack.com/x", init: { headers: { cookie: "gloomberb.session_token=leak" } } }),
      upstream, HOSTS, PRIVATE,
    );

    expect(seen[0]!.headers.has("cookie")).toBe(false);
  });

  test("keeps a third party's Set-Cookie out of the response headers", async () => {
    const response = await handleHttpProxy(
      privateRequest({ url: "https://substack.com/login" }),
      recordingUpstream(() => new Response("{}", { headers: { "set-cookie": "sid=x; Path=/" } })).upstream,
      HOSTS, PRIVATE,
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json() as { setCookie: string[] }).setCookie).toEqual(["sid=x; Path=/"]);
  });

  test("refuses a response over the size limit, declared or not", async () => {
    const huge = "x".repeat(5 * 1024 * 1024 + 1);
    const undeclared = await handleHttpProxy(
      privateRequest({ url: "https://substack.com/big" }),
      recordingUpstream(() => new Response(huge)).upstream,
      HOSTS, PRIVATE,
    );
    const declared = await handleHttpProxy(
      privateRequest({ url: "https://substack.com/big" }),
      recordingUpstream(() => new Response("small", { headers: { "content-length": String(6 * 1024 * 1024) } })).upstream,
      HOSTS, PRIVATE,
    );

    expect(undeclared.status).toBe(502);
    expect(declared.status).toBe(502);
  });

  describe("redirects", () => {
    const REDIRECT_HOSTS = ["substack.com", "substackcdn.com"];

    test("follows a redirect to another allowlisted host, dropping credentials across origins", async () => {
      const { seen, upstream } = recordingUpstream((url) => url.startsWith("https://substack.com/")
        ? new Response(null, { status: 302, headers: { location: "https://substackcdn.com/file" } })
        : new Response("done"));
      const response = await handleHttpProxy(
        privateRequest({ url: "https://substack.com/start", init: { headers: { authorization: "Bearer plugin", cookie: "a=b" } } }),
        upstream, REDIRECT_HOSTS, PRIVATE,
      );

      expect((await response.json() as { body: string }).body).toBe("done");
      expect(seen.map((request) => request.url)).toEqual(["https://substack.com/start", "https://substackcdn.com/file"]);
      expect(seen[0]!.headers.get("authorization")).toBe("Bearer plugin");
      expect(seen[1]!.headers.has("authorization")).toBe(false);
      expect(seen[1]!.headers.has("cookie")).toBe(false);
    });

    test.each([
      ["https://evil.example/steal", "an unlisted host"],
      ["http://substack.com/downgrade", "plain http"],
      ["https://169.254.169.254/latest/meta-data", "a metadata IP"],
      ["https://substack.com:8443/x", "a non-default port"],
    ])("refuses a redirect to %s (%s) without fetching it", async (location) => {
      const { seen, upstream } = recordingUpstream(() => new Response(null, { status: 302, headers: { location } }));
      const response = await handleHttpProxy(privateRequest({ url: "https://substack.com/start" }), upstream, REDIRECT_HOSTS, PRIVATE);

      expect(response.status).toBe(502);
      expect(seen).toHaveLength(1);
    });

    test("stops a redirect loop", async () => {
      const { seen, upstream } = recordingUpstream(() => new Response(null, { status: 302, headers: { location: "/again" } }));
      const response = await handleHttpProxy(privateRequest({ url: "https://substack.com/start" }), upstream, REDIRECT_HOSTS, PRIVATE);

      expect(response.status).toBe(502);
      expect(seen.length).toBeLessThanOrEqual(6);
    });

    test("hands a manual redirect back to the plugin unfollowed", async () => {
      const { seen, upstream } = recordingUpstream(() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
      const response = await handleHttpProxy(
        privateRequest({ url: "https://substack.com/start", init: { redirect: "manual" } }),
        upstream, REDIRECT_HOSTS, PRIVATE,
      );

      expect((await response.json() as { status: number }).status).toBe(302);
      expect(seen).toHaveLength(1);
    });
  });
});
