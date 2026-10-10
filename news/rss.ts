import { decodeHtmlEntities } from "gloomberb/utils";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: Date;
  summary?: string;
  categories: string[];
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return null;
  const raw = match[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return decodeHtmlEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** RSS 2.0 (`pubDate`) and RSS 1.0/RDF (`dc:date`) items. Items without a title, link or date are skipped. */
export function parseFeed(xml: string): FeedItem[] {
  if (!/<(rss|rdf:RDF|feed)\b/i.test(xml)) throw new Error("Feed format was not recognised");
  const items: FeedItem[] = [];
  for (const block of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const title = tag(block, "title");
    const url = tag(block, "link") ?? block.match(/rdf:about="([^"]+)"/)?.[1] ?? null;
    const when = tag(block, "pubDate") ?? tag(block, "dc:date");
    const publishedAt = when ? new Date(when) : null;
    if (!title || !url || !publishedAt || Number.isNaN(publishedAt.getTime())) continue;
    const summary = tag(block, "description") ?? undefined;
    const categories = [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((match) => decodeHtmlEntities(match[1]!.replace(/<!\[CDATA\[|\]\]>/g, "")).trim())
      .filter(Boolean);
    items.push({ title, url, publishedAt, ...(summary ? { summary } : {}), categories });
  }
  return items;
}
