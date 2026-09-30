/**
 * Endpoints behind the announcements pages on asx.com.au.
 *
 * None of this is documented by ASX or Markit Digital. Every URL here was
 * copied from open-source consumers that work against the live service (see
 * docs/research/01-asx-announcement-data-sources.md, section 2.1) and must be
 * confirmed by the live-testing pass in docs/live-testing.md.
 */

export const ASX_API_HOST = "asx.api.markitdigital.com";
export const ASX_CDN_HOST = "cdn-api.markitdigital.com";
export const ASX_WEB_HOST = "www.asx.com.au";

/**
 * Every host the plugin fetches from, for the `hosts` field of the manifest.
 * On the web these become the worker proxy's allowlist, so the asx.com.au
 * page, which is only ever opened in the user's browser, is left out.
 */
export const PLUGIN_HOSTS: readonly string[] = [ASX_API_HOST, ASX_CDN_HOST];

const API_BASE = `https://${ASX_API_HOST}/asx-research/1.0`;
const FILE_BASE = `https://${ASX_CDN_HOST}/apiman-gateway/ASX/asx-research/1.0/file`;

export function normaliseAsxCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Resolves a ticker code to the entity xid the announcements endpoint filters on. */
export function predictiveSearchUrl(code: string): string {
  return `${API_BASE}/search/predictive?searchText=${encodeURIComponent(normaliseAsxCode(code))}`;
}

export interface AnnouncementsQuery {
  xid: string;
  page: number;
  itemsPerPage: number;
}

/**
 * The `entityXids[]` key is sent with literal brackets because that is the
 * form the working Discord bot uses. If the live pass shows the service wants
 * `entityXids=%5B...%5D` (a JSON array, as the whole-market poller sends),
 * change it here only.
 */
export function announcementsUrl({ xid, page, itemsPerPage }: AnnouncementsQuery): string {
  return `${API_BASE}/markets/announcements?entityXids[]=${encodeURIComponent(xid)}&page=${page}&itemsPerPage=${itemsPerPage}`;
}

/**
 * The PDF behind an announcement. Public copies of this URL circulate both
 * with and without `access_token`; the token seen in the wild is a site-wide
 * value embedded in the ASX front end, not a per-user secret. Whether the
 * bare form works is one of the live checks.
 */
export function pdfUrl(documentKey: string, accessToken?: string | null): string {
  const base = `${FILE_BASE}/${encodeURIComponent(documentKey)}`;
  return accessToken ? `${base}?access_token=${encodeURIComponent(accessToken)}` : base;
}

/** The human-facing announcements page for a code on asx.com.au. */
export function asxAnnouncementsPageUrl(code: string): string {
  return `https://${ASX_WEB_HOST}/markets/trade-our-cash-market/announcements.${normaliseAsxCode(code).toLowerCase()}`;
}
