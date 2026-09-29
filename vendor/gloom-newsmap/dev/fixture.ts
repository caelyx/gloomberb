import type { Headline } from "../types";

/**
 * A stand-in board for checking layout, colour, density and wrapping without
 * touching Google News — which rate-limits an IP that refetches while someone is
 * iterating on tile geometry. The Japanese and long-word entries are the cases
 * the wrap has to survive.
 */
const HOUR = 3_600_000;
/** A declared host, so `plugin doctor` does not flag a fixture URL as an
 * undeclared one the web build would fail to reach. */
const ARTICLE_BASE = "https://news.google.com/rss/articles";

const ROWS: Array<[section: string, rank: number, ageHours: number, cluster: number, source: string, title: string]> = [
  ["WORLD", 0, 0.2, 5, "Reuters", "Ceasefire talks resume after overnight strikes on the northern border"],
  ["WORLD", 1, 2, 3, "The Guardian", "Record heat closes schools across three states"],
  ["WORLD", 2, 9, 1, "Al Jazeera", "Aid convoy turned back for a fourth day"],
  ["NATION", 0, 0.5, 4, "ABC News", "RBA lifts rates to the highest level in fifteen years"],
  ["NATION", 1, 3, 2, "The Australian", "Two-year-old euthanised in Dutch first"],
  ["NATION", 2, 14, 0, "SMH.com.au", "Public banned from City Beach as expert warns of 31-tonne whale"],
  ["BUSINESS", 0, 1, 5, "Financial Times", "Major lender suspends three funds and cuts asset values after audit"],
  ["BUSINESS", 1, 6, 2, "AFR", "First home buyers shying away from property"],
  ["BUSINESS", 2, 22, 1, "Bloomberg", "Card surcharges are ending — how will it affect you?"],
  ["TECHNOLOGY", 0, 0.8, 3, "WIRED", "Researchers built a disembodied robotic hand that walks on its fingertips"],
  ["TECHNOLOGY", 1, 5, 1, "TweakTown", "Antidisestablishmentarianism trends after a spelling bee upset"],
  ["TECHNOLOGY", 2, 30, 0, "Polygon", "Super Mario Galaxy on PC is one step closer to being a reality"],
  ["WORLD", 3, 16, 2, "BBC News", "Election monitors report irregularities in three provinces"],
  ["WORLD", 4, 26, 0, "AP", "Volcano alert raised on the island's northern flank"],
  ["WORLD", 5, 40, 1, "Le Monde", "Fishing dispute flares again in contested waters"],
  ["NATION", 3, 4, 3, "news.com.au", "Cocaine bricks worth $10m replaced with flour in drug trial"],
  ["NATION", 4, 11, 1, "The Age", "Rail shutdown to stretch into a third week"],
  ["NATION", 5, 19, 0, "WAtoday", "Council votes to rename the foreshore precinct"],
  ["NATION", 6, 33, 0, "The Advertiser", "Desalination plant runs at capacity for the first time"],
  ["BUSINESS", 3, 8, 3, "Reuters", "Miner halts output at its largest pit after a wall collapse"],
  ["BUSINESS", 4, 13, 1, "The Economist", "Container rates slide as the backlog clears"],
  ["BUSINESS", 5, 21, 0, "CNBC", "Retailer warns on margins ahead of the holiday quarter"],
  ["BUSINESS", 6, 36, 1, "WSJ", "Pension fund shifts a tenth of its book into credit"],
  ["TECHNOLOGY", 3, 7, 2, "The Verge", "Handset maker delays its foldable to the second half"],
  ["TECHNOLOGY", 4, 12, 0, "Ars Technica", "Long-running filesystem bug finally traced to a firmware race"],
  ["TECHNOLOGY", 5, 18, 1, "Tom's Hardware", "Memory prices tick up as fab capacity tightens"],
  ["TECHNOLOGY", 6, 28, 0, "Engadget", "Streaming box drops support for its oldest hardware"],
  ["TECHNOLOGY", 7, 44, 0, "The Register", "Datacentre operator sued over a cooling outage"],
];

const JAPANESE: Array<[rank: number, ageHours: number, title: string]> = [
  [0, 0.3, "新型コロナウイルス感染症対策本部会議を開催"],
  [1, 2, "日銀が政策金利を据え置き、市場は円安進行を警戒"],
  [2, 7, "東京都心で観測史上最も遅い真夏日を記録"],
  [3, 20, "半導体大手が国内新工場の建設計画を発表"],
];

export function fixtureHeadlines(japanese = false): Headline[] {
  const now = Date.now();
  if (japanese) {
    return JAPANESE.map(([rank, ageHours, title]) => ({
      id: `WORLD:${rank}`, title, url: `${ARTICLE_BASE}/fixture-jp-${rank}`, source: "共同通信",
      publishedAt: now - ageHours * HOUR, section: "WORLD", rank, relatedCount: 5 - rank,
    }));
  }
  return ROWS.map(([section, rank, ageHours, cluster, source, title]) => ({
    id: `${section}:${rank}`, title, url: `${ARTICLE_BASE}/fixture-${section}-${rank}`, source,
    publishedAt: now - ageHours * HOUR, section, rank, relatedCount: cluster,
  }));
}
