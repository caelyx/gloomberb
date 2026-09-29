import { createThrottledFetch, httpFetch, type HttpFetchTransport, type ThrottledFetchClient } from "gloomberb/utils";
import type { AnnouncementsPage, EntityMatch } from "./model";
import { parseAnnouncementsPage, parsePredictiveSearch, pickEntityForCode } from "./parse";
import { announcementsUrl, normaliseAsxCode, pdfUrl, predictiveSearchUrl } from "./urls";
import { PLUGIN_HOMEPAGE, PLUGIN_VERSION } from "../version";

/**
 * Identifies the plugin honestly, the way Gloomberb's own EDGAR client does.
 * Browsers drop this header; in the terminal and desktop it reaches the server.
 */
export const USER_AGENT = `gloom-asx/${PLUGIN_VERSION} (+${PLUGIN_HOMEPAGE})`;

export const DEFAULT_ITEMS_PER_PAGE = 50;
/** Well under what a person clicking through the ASX site would generate. */
export const DEFAULT_REQUESTS_PER_MINUTE = 20;

export class AsxHttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`ASX request failed with HTTP ${status}: ${url}`);
    this.name = "AsxHttpError";
  }
}

export class AsxResponseError extends Error {
  constructor(readonly url: string) {
    super(`ASX returned a response that is not JSON: ${url}`);
    this.name = "AsxResponseError";
  }
}

export class AsxLookupError extends Error {
  constructor(readonly code: string) {
    super(`No ASX entity found for code ${code}`);
    this.name = "AsxLookupError";
  }
}

export interface AsxClientOptions {
  /** Test seam; production goes through Gloomberb's `httpFetch`. */
  transport?: HttpFetchTransport;
  accessToken?: string | null;
  itemsPerPage?: number;
  requestsPerMinute?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export class AsxClient {
  readonly itemsPerPage: number;
  readonly accessToken: string | null;
  private readonly http: ThrottledFetchClient;

  constructor(options: AsxClientOptions = {}) {
    this.itemsPerPage = options.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE;
    this.accessToken = options.accessToken ?? null;
    this.http = createThrottledFetch({
      requestsPerMinute: options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE,
      maxRetries: options.maxRetries ?? 2,
      timeoutMs: options.timeoutMs ?? 15_000,
      backoffBaseMs: 1_000,
      dedupeGetRequests: true,
      defaultHeaders: { "User-Agent": USER_AGENT },
      transport: options.transport ?? httpFetch,
    });
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.http.fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new AsxHttpError(response.status, url);
    try {
      return await response.json();
    } catch {
      throw new AsxResponseError(url);
    }
  }

  async lookupEntity(code: string): Promise<EntityMatch> {
    const normalised = normaliseAsxCode(code);
    const matches = parsePredictiveSearch(await this.getJson(predictiveSearchUrl(normalised)));
    const entity = pickEntityForCode(matches, normalised);
    if (!entity) throw new AsxLookupError(normalised);
    return entity;
  }

  async fetchAnnouncementsPage(xid: string, page: number): Promise<AnnouncementsPage> {
    const json = await this.getJson(announcementsUrl({ xid, page, itemsPerPage: this.itemsPerPage }));
    return parseAnnouncementsPage(json, { page, itemsPerPage: this.itemsPerPage, accessToken: this.accessToken });
  }

  async fetchPdf(documentKey: string): Promise<Uint8Array> {
    const url = pdfUrl(documentKey, this.accessToken);
    const response = await this.http.fetch(url, { headers: { Accept: "application/pdf, */*" } });
    if (!response.ok) throw new AsxHttpError(response.status, url);
    return new Uint8Array(await response.arrayBuffer());
  }
}
