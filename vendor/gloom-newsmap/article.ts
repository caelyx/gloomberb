import { Readability } from "@mozilla/readability";
import { createThrottledFetch } from "gloomberb/utils";
import { parseHTML } from "linkedom";

export interface Article {
  /** Plain-text blocks in reading order: paragraphs, headings, list items, quotes. */
  paragraphs: string[];
}

/**
 * A separate client from the Hacker News one: article sites are slower and
 * less reliable than the HN API, so they get a longer timeout and fewer retries.
 */
const articleFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 1,
  // The pane caches finished articles itself. Sharing an in-flight request
  // would let one cancelled caller fail another reading the same URL.
  dedupeGetRequests: false,
  defaultHeaders: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
});

/**
 * `createThrottledFetch` applies its own `timeoutMs` only when the caller
 * passes no signal, and the pane always passes one so it can cancel, so the
 * timeout is folded into the signal instead.
 */
const TIMEOUT_MS = 15_000;

/**
 * Parsing runs on the UI thread, at roughly 200ms a megabyte; past this a page
 * would freeze the terminal for longer than it is worth reading here.
 */
const MAX_PAGE_CHARS = 3_000_000;

/**
 * Elements that start a new block of text. Everything else (links, emphasis,
 * code spans) is read inline as part of the surrounding block.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE",
  "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION",
  "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Reader-view text for a page, or null when there is no article to find.
 *
 * Readability (the parser behind Firefox Reader View) picks the article out of
 * the page; linkedom supplies the DOM it needs without a browser, so this runs
 * on every renderer. Readability's own `textContent` runs paragraphs together,
 * so the cleaned HTML is walked again and split at block boundaries.
 */
export function extractArticle(html: string): Article | null {
  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed?.content) return null;

  const { document: content } = parseHTML(`<!doctype html><html><body>${parsed.content}</body></html>`);
  const paragraphs: string[] = [];
  collectBlocks(content.body as unknown as Node, paragraphs);
  return paragraphs.length > 0 ? { paragraphs } : null;
}

/**
 * Appends the text of `node` to `out`, one entry per block. Text that sits
 * beside a nested block, like "Fruits" in `<li>Fruits<ul><li>Apple</li></ul></li>`,
 * becomes its own entry rather than being lost, and `<br><br>` separates
 * paragraphs the way it does on older hand-written pages.
 */
function collectBlocks(node: Node, out: string[]): void {
  let inline = "";
  const flush = () => {
    for (const paragraph of inline.split(/\n\s*\n/)) {
      const text = paragraph.replace(/\s+/g, " ").trim();
      if (text) out.push(text);
    }
    inline = "";
  };

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      inline += child.textContent ?? "";
    } else if (child.nodeType === ELEMENT_NODE) {
      const tag = (child as Element).tagName;
      if (tag === "BR") {
        inline += "\n";
      } else if (tag === "TR") {
        flush();
        const row = tableRowText(child as Element);
        if (row) out.push(row);
      } else if (tag === "PRE") {
        flush();
        const text = preformattedText(child.textContent ?? "");
        if (text) out.push(text);
      } else if (BLOCK_TAGS.has(tag)) {
        flush();
        collectBlocks(child, out);
      } else {
        inline += inlineText(child);
      }
    }
  }
  flush();
}

/** A table row as one line, `Make | Year | Price`, rather than a paragraph per cell. */
function tableRowText(row: Element): string {
  const cells = Array.from(row.children)
    .filter((cell) => cell.tagName === "TD" || cell.tagName === "TH")
    .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
  return cells.some((cell) => cell.length > 0) ? cells.join(" | ").replace(/ {2,}/g, " ") : "";
}

/** Inline text with `<br>` kept as a line break, so `a<br>b` does not read as "ab". */
function inlineText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== ELEMENT_NODE) return "";
  if ((node as Element).tagName === "BR") return "\n";
  return Array.from(node.childNodes).map(inlineText).join("");
}

/** Preformatted text keeps its lines (advisories, code, mailing-list posts); everything else reflows. */
function preformattedText(text: string): string {
  return text.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
}

/**
 * True for addresses on the reader's own machine or network. Story URLs are
 * chosen by whoever submitted them, and opening a story fetches its URL with
 * no further click, so these are refused rather than requested. A public
 * hostname that resolves to a private address is not caught; that needs DNS.
 */
export function isLocalNetworkUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  if (host.startsWith("[")) {
    const ip = host.slice(1, -1);
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || ip.startsWith("fe80:") || ip.startsWith("::ffff:");
  }

  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d+$/.test(octet))) return false;
  const [a, b] = octets.map(Number) as [number, number, number, number];
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

/**
 * True when text decoded as UTF-8 was not UTF-8. Both the terminal's
 * `Response.text()` and the desktop proxy decode every page as UTF-8, so a
 * Latin-1 or Shift-JIS page arrives full of U+FFFD and cannot be recovered.
 */
export function looksMisdecoded(paragraphs: string[]): boolean {
  const text = paragraphs.join("");
  const replaced = text.match(/\uFFFD/g)?.length ?? 0;
  return replaced > 10 && replaced / text.length > 0.002;
}

/**
 * Plain-text pages (RFCs, READMEs, mailing-list archives) are already the
 * article. Their lines are hard-wrapped, so each blank-line-separated block
 * is reflowed into one paragraph.
 */
export function plainTextArticle(text: string): Article | null {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0);
  return paragraphs.length > 0 ? { paragraphs } : null;
}

export async function loadArticle(url: string, signal: AbortSignal): Promise<Article> {
  if (isLocalNetworkUrl(url)) throw new Error("Links to a local network address are not fetched.");

  let response: Response;
  try {
    response = await articleFetch.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
  } catch (error) {
    if (signal.aborted) throw error;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(timedOut ? "The site took too long to answer." : "Could not reach the site.");
  }
  if (!response.ok) throw new Error(`The site answered ${response.status}.`);

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const plain = contentType === "text/plain";
  if (contentType && !plain && !contentType.includes("html")) {
    throw new Error(`Not a web page (${contentType}).`);
  }

  const body = await response.text();
  if (body.length > MAX_PAGE_CHARS) throw new Error("The page is too large to read here.");

  const article = plain ? plainTextArticle(body) : extractArticle(body);
  if (!article) throw new Error("No readable article on the page.");
  if (looksMisdecoded(article.paragraphs)) throw new Error("The page uses a text encoding this reader cannot decode.");
  return article;
}
