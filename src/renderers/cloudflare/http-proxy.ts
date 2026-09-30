/**
 * Server half of the plugin HTTP transport for the hosted web app.
 *
 * The terminal reaches third-party APIs directly, and the desktop forwards
 * them to its Bun process (`http.fetch`). The web build has neither: it runs
 * on a real origin, so a plugin's request is subject to CORS, and it cannot
 * set `Cookie` because browsers own that header. This route is the web's
 * equivalent of the desktop backend, using the same envelope so the client
 * side of both transports behaves identically.
 *
 * The desktop version deliberately has no allowlist: it runs on the user's own
 * machine, reaching only what that machine could already reach. This one is
 * on the public internet, so an unrestricted copy would be an open proxy
 * running on our bandwidth and our IP reputation. Everything below exists to
 * keep that from happening.
 *
 * Downstream (private deployment): who may call this route is a deployment
 * policy, see `proxyPolicyFor`. The public service requires a Gloom session;
 * a private copy behind Cloudflare Access may drop only that requirement.
 * Every other check here applies in both modes.
 */
import { readRequestInit, toResponseEnvelope } from "../../utils/http-proxy-response";
import { isProxiedHost, PROXY_ALLOWED_HOSTS } from "../../utils/plugin-proxy-hosts";

const PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const SESSION_COOKIE_NAMES = ["__Secure-gloomberb.session_token", "gloomberb.session_token"];
/** Set by the caller's browser or meaningful only to the hop it came from. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
/**
 * Credentials that belong to this origin, never to a plugin's host: the Gloom
 * session (which the browser transport can plant as a readable cookie) and the
 * Cloudflare Access token of a private deployment. Removed from what a plugin
 * asks to send, so not even plugin code can pass them on.
 */
const ORIGIN_COOKIE_NAMES = new Set([...SESSION_COOKIE_NAMES, "CF_Authorization"]);
const ORIGIN_HEADER_PREFIX = "cf-access-";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface HttpProxyPolicy {
  /** Refuse callers without a Gloom session cookie (the public service). */
  requireSession: boolean;
}

/**
 * The public service's policy unless the deployment explicitly opts out.
 *
 * `PRIVATE_WEB_DEPLOYMENT` must be exactly "true" to drop the session
 * requirement. Unset, "false", "1", "yes" or a typo all keep it, so an
 * ambiguous configuration fails closed. The private mode is only safe when
 * something in front of the worker (Cloudflare Access) already limits who can
 * reach it; see docs/private-web-deployment.md.
 */
export function proxyPolicyFor(privateDeployment: unknown): HttpProxyPolicy {
  return { requireSession: privateDeployment !== "true" };
}

/**
 * Rejects anything that is not a plain https host on the allowlist.
 *
 * IP literals are refused outright rather than range-checked: no allowlisted
 * host needs one, and it removes the entire class of "does this address point
 * somewhere internal" bugs, including the decimal and IPv6-mapped spellings
 * that defeat naive checks.
 */
export function validateProxyTarget(
  rawUrl: unknown,
  hosts: readonly string[] = PROXY_ALLOWED_HOSTS,
): { url: URL } | { error: string; status: number } {
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) {
    return { error: "A target URL is required.", status: 400 };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "The target URL is not valid.", status: 400 };
  }
  if (url.protocol !== "https:") {
    return { error: "Only https targets are allowed.", status: 400 };
  }
  if (url.username || url.password) {
    return { error: "Credentials in the URL are not allowed.", status: 400 };
  }
  if (url.port && url.port !== "443") {
    return { error: "Only the default https port is allowed.", status: 400 };
  }
  if (/^\d|^\[|:/.test(url.hostname) || url.hostname === "localhost") {
    return { error: "The target host is not allowed.", status: 403 };
  }
  if (!isProxiedHost(url.hostname, hosts)) {
    return { error: "The target host is not on the plugin allowlist.", status: 403 };
  }
  return { url };
}

function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return SESSION_COOKIE_NAMES.some((name) => new RegExp(`(?:^|;\\s*)${name}=[^;]`).test(cookie));
}

function withoutOriginCookies(cookie: string): string {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !ORIGIN_COOKIE_NAMES.has((part.includes("=") ? part.slice(0, part.indexOf("=")) : part).trim()))
    .join("; ");
}

function upstreamHeaders(raw: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower) || lower.startsWith(ORIGIN_HEADER_PREFIX)) continue;
    const value = lower === "cookie" ? withoutOriginCookies(rawValue) : rawValue;
    if (!value && lower === "cookie") continue;
    try {
      headers.set(name, value);
    } catch {
      // A header name the runtime refuses is dropped rather than failing the
      // whole request, matching how a browser treats an unsettable header.
    }
  }
  return headers;
}

function proxyError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

interface UpstreamRequest {
  method: string;
  headers: Headers;
  body?: string;
  redirect: "follow" | "error" | "manual";
  signal: AbortSignal;
}

/**
 * `fetch` with `redirect: "follow"` would go wherever an allowlisted host
 * points, including hosts nobody allowlisted. Redirects are followed here
 * instead, one hop at a time, and every hop passes `validateProxyTarget` again.
 * Credentials a plugin set are dropped when a hop changes origin, as browsers do.
 */
async function fetchWithCheckedRedirects(
  target: URL,
  request: UpstreamRequest,
  fetchUpstream: typeof fetch,
  hosts: readonly string[],
): Promise<Response | { error: string; status: number }> {
  let url = target;
  let { method, body } = request;
  const headers = new Headers(request.headers);
  for (let hop = 0; ; hop += 1) {
    const response = await fetchUpstream(url, { method, headers, body, redirect: "manual", signal: request.signal });
    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || !location || request.redirect === "manual") return response;
    await response.body?.cancel();
    if (request.redirect === "error") return { error: "The upstream redirected.", status: 502 };
    if (hop >= MAX_REDIRECTS) return { error: "The upstream redirected too many times.", status: 502 };
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return { error: "The upstream redirected to an invalid URL.", status: 502 };
    }
    const checked = validateProxyTarget(next.href, hosts);
    if ("error" in checked) return { error: `The upstream redirected to a refused target. ${checked.error}`, status: 502 };
    if (checked.url.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
      headers.delete("content-type");
    }
    url = checked.url;
  }
}

/**
 * Note the upstream request is built only from the envelope. Forwarding the
 * incoming request's headers would hand the caller's Gloomberb session cookie
 * to a third party, which is the opposite of what this exists to do.
 */
export async function handleHttpProxy(
  request: Request,
  fetchUpstream: typeof fetch = fetch,
  hosts: readonly string[] = PROXY_ALLOWED_HOSTS,
  policy: HttpProxyPolicy = proxyPolicyFor(undefined),
): Promise<Response> {
  if (request.method !== "POST") {
    return proxyError("Method not allowed", 405);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return proxyError("Origin not allowed", 403);
  }
  if (policy.requireSession && !hasSessionCookie(request)) {
    return proxyError("Sign in to use plugin requests.", 401);
  }
  // Without the session check nothing else says the caller is this app's own
  // page, so the browser's Origin header is required rather than optional.
  if (!policy.requireSession && !origin) {
    return proxyError("Origin required", 403);
  }

  let payload: { url?: unknown; init?: unknown };
  try {
    payload = await request.json() as { url?: unknown; init?: unknown };
  } catch {
    return proxyError("The request body is not valid JSON.", 400);
  }

  const target = validateProxyTarget(payload.url, hosts);
  if ("error" in target) return proxyError(target.error, target.status);

  const init = readRequestInit(payload.init);
  if (!PROXY_METHODS.has(init.method)) {
    return proxyError("Method not allowed", 405);
  }

  let response: Response;
  try {
    const result = await fetchWithCheckedRedirects(target.url, {
      method: init.method,
      headers: upstreamHeaders(init.headers),
      body: init.body,
      redirect: init.redirect ?? "follow",
      signal: AbortSignal.timeout(Math.min(init.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)),
    }, fetchUpstream, hosts);
    if ("error" in result) return proxyError(result.error, result.status);
    response = result;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return proxyError(timedOut ? "The upstream request timed out." : "The upstream request failed.", 504);
  }

  // Refused before buffering when the upstream says up front it is too large.
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (init.method !== "HEAD" && declaredLength > MAX_BODY_BYTES) {
    await response.body?.cancel();
    return proxyError("The upstream response is too large.", 502);
  }

  // `set-cookie` comes back in `setCookie`, never as a header, so a third party
  // cannot set cookies on the Gloomberb origin.
  const envelope = await toResponseEnvelope(response);
  if (envelope.body.length > MAX_BODY_BYTES) {
    return proxyError("The upstream response is too large.", 502);
  }
  return Response.json(envelope, { headers: { "cache-control": "no-store" } });
}
