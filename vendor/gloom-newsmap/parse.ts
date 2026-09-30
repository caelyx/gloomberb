/**
 * Feed URLs and RSS parsing, kept free of host imports so the parser can be
 * tested against a fixture without a Gloomberb checkout.
 */
import { editionById, type Headline } from "./types";

const BASE = "https://news.google.com/rss";

/**
 * Google News serves the front page at /rss and every section under
 * /rss/headlines/section/topic/<TOPIC>. The edition is carried entirely by the
 * query string, so the two forms differ only in path.
 */
export function feedUrl(section: string, editionId: string): string {
  const edition = editionById(editionId);
  const query = `hl=${encodeURIComponent(edition.hl)}&gl=${encodeURIComponent(edition.gl)}&ceid=${encodeURIComponent(edition.ceid)}`;
  return section === "TOP"
    ? `${BASE}?${query}`
    : `${BASE}/headlines/section/topic/${encodeURIComponent(section)}?${query}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  hellip: "…", mdash: "—", ndash: "–",
};

/**
 * Titles arrive escaped once inside the XML and the related-article list is
 * escaped a second time inside <description>, so this runs more than once over
 * the same text and has to be safe to repeat.
 */
const MAX_CODE_POINT = 0x10ffff;

/** Surrogate halves are not characters; emitting one produces a lone surrogate
 * that breaks string handling downstream. */
function isUsableCodePoint(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code <= MAX_CODE_POINT
    && !(code >= 0xd800 && code <= 0xdfff);
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      // Left alone rather than thrown on: `String.fromCodePoint` raises for
      // anything past U+10FFFF, and one malformed character in one item used
      // to reject the whole section's feed.
      return isUsableCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return isUsableCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * CDATA is matched first and as a whole, because a non-greedy tag match stops
 * at the first close tag — including one that is only there as text inside the
 * CDATA, which left the literal `<![CDATA[` in the headline.
 *
 * `\\b[^>]*` rather than `[^>]*` so `<source url="...">` matches but `<sourceX>`
 * does not.
 */
function tagText(xml: string, tag: string): string | null {
  const cdata = new RegExp(`<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`).exec(xml);
  if (cdata?.[1] != null) return decodeEntities(cdata[1]).trim();
  const plain = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return plain?.[1] == null ? null : decodeEntities(plain[1]).trim();
}

/**
 * Google News appends " - Publisher" to most headlines, which wastes the
 * scarcest thing a tile has. The publisher is already its own field.
 */
function stripTrailingSource(title: string, source: string): string {
  if (!source) return title;
  const suffix = ` - ${source}`;
  if (!title.endsWith(suffix)) return title;
  // A title that was only its own publisher must keep something to draw.
  const stripped = title.slice(0, -suffix.length).trim();
  return stripped ? stripped : title;
}

/**
 * How many outlets are carrying the story. The <description> holds an <ol> of
 * the cluster, the first entry being the headline item itself — and Google
 * caps the list at five, so this saturates rather than ranking the top stories
 * against each other.
 */
function relatedCountFrom(description: string | null): number {
  if (!description) return 0;
  // Counted on the description as `tagText` already decoded it — once. The
  // markup arrives escaped twice, so one decode yields real `<li>` tags; a
  // second turned any `&amp;lt;li&amp;gt;` in the *text* into a phantom
  // cluster entry, which inflated the tile.
  const items = description.match(/<li\b/gi)?.length ?? 0;
  return Math.max(0, items - 1);
}

/**
 * Depth-aware rather than a non-greedy match: `<item >` and `<item x="y">` are
 * both valid and a plain `<item>` pattern silently parsed such a feed to zero
 * headlines, while a nested item truncated its parent and paired the outer
 * title with the inner link — a tile that opens the wrong article.
 */
function stripNestedItems(body: string): string {
  return body.replace(/<item\b[^>]*>[\s\S]*?<\/item>/gi, "");
}

function splitItems(xml: string): string[] {
  const boundary = /<item\b[^>]*>|<\/item>/gi;
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let match = boundary.exec(xml); match; match = boundary.exec(xml)) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      // Nested items are stripped from the body, not just excluded from the
      // split: otherwise the outer item's tag lookup finds the inner item's
      // link first and the tile opens the wrong article.
      if (depth === 0) items.push(stripNestedItems(xml.slice(start, match.index)));
      if (depth < 0) depth = 0;
      continue;
    }
    if (depth === 0) start = match.index + match[0].length;
    depth += 1;
  }
  return items;
}

export function parseGoogleNewsFeed(xml: string, section: string): Headline[] {
  const items = splitItems(xml);
  const headlines: Headline[] = [];

  items.forEach((item, rank) => {
    const rawTitle = tagText(item, "title");
    const url = tagText(item, "link");
    if (!rawTitle || !url) return;

    const source = tagText(item, "source") ?? "";
    const published = Date.parse(tagText(item, "pubDate") ?? "");

    headlines.push({
      // The feed's own guid can repeat across sections for a shared story;
      // scoping by section keeps both tiles addressable.
      id: `${section}:${url}`,
      title: stripTrailingSource(rawTitle, source),
      url,
      source,
      publishedAt: Number.isFinite(published) ? published : Date.now(),
      section,
      rank,
      relatedCount: relatedCountFrom(tagText(item, "description")),
    });
  });

  return headlines;
}

