import { decodeHtmlEntities, zonedWallClockToUtcMs } from "gloomberb/utils";
import { ASX_TIME_ZONE } from "../shared/asx";
import type { FeedItem } from "./rss";

/**
 * ASIC publishes no RSS feed. Its newsroom pages render from this JSON (found
 * in the site's script), the latest 20 media releases.
 */
export const ASIC_MEDIA_RELEASES_URL = "https://download.asic.gov.au/asic-nga/data/newsroom/newsroom-mr-latest.json";

const SITE = "https://www.asic.gov.au";
/** Links are kept only when they point at ASIC itself. */
const ASIC_HOSTS = new Set(["www.asic.gov.au", "download.asic.gov.au"]);

interface RawRelease {
  name?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  dateCreated?: unknown;
  documentNumber?: unknown;
  metaDescription?: unknown;
  robotsNofollowNoindex?: unknown;
}

export interface AsicRelease extends FeedItem {
  /** `26-237MR`, when the release has one. */
  releaseNumber?: string;
}

/**
 * `publishedDate` carries a `Z` but is Sydney wall-clock time: "2026-09-18T16:45:00Z"
 * is the release ASIC's page dates "18/09/2026 04:45 PM", saved at 06:45 UTC.
 * At the DST edges `zonedWallClockToUtcMs` decides: the repeated hour in April
 * reads as standard time, the skipped hour in October rolls forward, and an
 * impossible date rolls over. None of that matters for a release's time.
 */
function sydneyInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  const ms = zonedWallClockToUtcMs(ASX_TIME_ZONE, year!, month!, day!, hour!, minute!, second || 0);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** An absolute https link on an ASIC host, or null. */
function asicLink(path: string): string | null {
  try {
    const url = new URL(path, SITE);
    return url.protocol === "https:" && ASIC_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The headline without its leading release number: "26-237MR Full Federal Court …". */
function withoutNumber(name: string, number: string): string {
  return number && name.toUpperCase().startsWith(number.toUpperCase()) ? name.slice(number.length).trim() : name;
}

function text(value: unknown): string {
  return typeof value === "string" ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : "";
}

/** ASIC's newsroom media-release list. Items without a headline, an ASIC link or a date, and pages ASIC hides from search, are skipped. */
export function parseAsicMediaReleases(body: string): AsicRelease[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error("ASIC media releases were not JSON");
  }
  if (!Array.isArray(raw)) throw new Error("ASIC media releases were not a list");
  const items: AsicRelease[] = [];
  for (const entry of raw as RawRelease[]) {
    if (!entry || typeof entry !== "object" || entry.robotsNofollowNoindex === true) continue;
    const number = text(entry.documentNumber) || text(entry.name).match(/^\d{2}-\d{3,4}MR\b/i)?.[0]?.toUpperCase() || "";
    const title = withoutNumber(text(entry.name), number);
    const url = asicLink(text(entry.url));
    const publishedAt = sydneyInstant(entry.publishedDate) ?? sydneyInstant(entry.dateCreated);
    if (!title || !url || !publishedAt) continue;
    const summary = text(entry.metaDescription);
    items.push({
      title,
      url,
      publishedAt,
      ...(summary ? { summary } : {}),
      categories: number ? [number] : [],
      ...(number ? { releaseNumber: number } : {}),
    });
  }
  return items;
}
