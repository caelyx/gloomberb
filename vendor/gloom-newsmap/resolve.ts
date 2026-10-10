import { httpFetch } from "gloomberb/utils";

import { loadArticleUrl } from "./cache";

/**
 * Google News links point at Google, not the publisher, and Google does not
 * redirect: the link answers with a page that finds the real URL in script.
 * That page carries the article id, a timestamp and a signature, and Google's
 * own batchexecute endpoint trades those for the URL. Neither is documented,
 * so every step here fails with a message the pane can show rather than
 * throwing something a reader cannot act on.
 */
const BATCH_EXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";
const TIMEOUT_MS = 15_000;
const UNRESOLVED = "Google News did not say where this story links to.";

export interface DecodingParams {
  id: string;
  timestamp: number;
  signature: string;
}

export function isGoogleNewsArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "news.google.com" && /^\/(rss\/)?articles\/[^/]+$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Read with a regex rather than a DOM: the page is over half a megabyte. */
export function parseDecodingParams(html: string): DecodingParams | null {
  const attribute = (name: string) => new RegExp(`\\b${name}="([^"]+)"`).exec(html)?.[1];
  const id = attribute("data-n-a-id");
  const timestamp = Number(attribute("data-n-a-ts"));
  const signature = attribute("data-n-a-sg");
  return id && signature && Number.isFinite(timestamp) ? { id, timestamp, signature } : null;
}

/** The `f.req` form body for one `garturlreq` call, in the shape Google's own page sends. */
export function buildBatchExecuteBody({ id, timestamp, signature }: DecodingParams): string {
  const call = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    timestamp,
    signature,
  ];
  return new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", JSON.stringify(call), null, "generic"]]]) }).toString();
}

/**
 * The publisher URL from a batchexecute answer: an anti-JSON prefix, then rows
 * whose third element is the call's own result as a JSON string,
 * `["garturlres", "<url>", 1]`.
 */
export function parseBatchExecuteResponse(text: string): string {
  let rows: unknown;
  try {
    rows = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
  } catch {
    throw new Error(UNRESOLVED);
  }
  if (!Array.isArray(rows)) throw new Error(UNRESOLVED);

  for (const row of rows) {
    if (!Array.isArray(row) || row[0] !== "wrb.fr" || row[1] !== "Fbv4je" || typeof row[2] !== "string") continue;
    let result: unknown;
    try {
      result = JSON.parse(row[2]);
    } catch {
      continue;
    }
    const url = Array.isArray(result) && result[0] === "garturlres" ? result[1] : null;
    // Opening a story fetches this URL with no further click, so only web URLs pass.
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
  }
  throw new Error(UNRESOLVED);
}

/** A request to Google, with transport failures worded for the pane. */
async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await httpFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(timedOut ? "Google News took too long to answer." : "Could not reach Google News.");
  }
  if (!response.ok) throw new Error(`Google News answered ${response.status}.`);
  return response;
}

async function fetchPublisherUrl(url: string): Promise<string> {
  const page = await googleFetch(url);
  const params = parseDecodingParams(await page.text());
  if (!params) throw new Error(UNRESOLVED);

  const answer = await googleFetch(BATCH_EXECUTE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: buildBatchExecuteBody(params),
  });
  return parseBatchExecuteResponse(await answer.text());
}

/**
 * The publisher's URL for a story. Anything that is not a Google News link is
 * already one. Google's answer never changes for a given link, so it is cached
 * for as long as the cache keeps anything, and a story is resolved once.
 *
 * It takes no abort signal: the cache entry is shared, so a reader closed
 * mid-lookup still finishes it, and reopening the story finds it done.
 */
export async function resolveArticleUrl(url: string): Promise<string> {
  if (!isGoogleNewsArticleUrl(url)) return url;
  // The query string carries only the edition and a tracking flag.
  return loadArticleUrl(url.split("?")[0]!, () => fetchPublisherUrl(url));
}
