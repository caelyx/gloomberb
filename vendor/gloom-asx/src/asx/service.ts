import type { PluginCacheResult } from "gloomberb/utils";
import { announcementsCacheKey, type AsxCaches } from "./cache";
import type { AsxClient } from "./client";
import { toExtractUnavailable } from "./extract-error";
import type { AnnouncementExtract, AnnouncementsPage, AsxAnnouncement, EntityMatch } from "./model";
import { extractPdfText } from "./pdf-text";
import { cleanPdfText, extractSummary } from "./summary";

export interface AsxServiceOptions {
  /** Pages of each PDF read for the extract. Two covers the cover letter of most announcements. */
  maxPdfPages?: number;
  maxExtractChars?: number;
}

/** Cache-first access to announcements; the network is touched only on a miss, on expiry, or on demand. */
export class AsxAnnouncementsService {
  private readonly maxPdfPages: number;
  private readonly maxExtractChars: number;
  private readonly inflightEntities = new Map<string, Promise<EntityMatch>>();

  constructor(readonly client: AsxClient, readonly caches: AsxCaches, options: AsxServiceOptions = {}) {
    this.maxPdfPages = options.maxPdfPages ?? 2;
    this.maxExtractChars = options.maxExtractChars ?? 2_000;
  }

  async resolveEntity(code: string): Promise<EntityMatch> {
    const cached = this.caches.getEntity(code);
    if (cached) return cached;
    let inflight = this.inflightEntities.get(code);
    if (!inflight) {
      inflight = this.client.lookupEntity(code).then((entity) => {
        this.caches.setEntity(code, entity);
        return entity;
      }).finally(() => this.inflightEntities.delete(code));
      this.inflightEntities.set(code, inflight);
    }
    return inflight;
  }

  async loadPage(code: string, page: number, { force = false } = {}): Promise<PluginCacheResult<AnnouncementsPage>> {
    const key = announcementsCacheKey(code, page, this.client.itemsPerPage);
    return this.caches.announcements.load(key, async () => {
      const entity = await this.resolveEntity(code);
      return this.client.fetchAnnouncementsPage(entity.xid, page);
    }, { force });
  }

  /**
   * The extract is an enhancement: any failure to download or read the PDF
   * rejects with an `ExtractUnavailableError` whose message can be shown in
   * place of the extract, and nothing is cached, so the announcement stays
   * listed and its PDF stays openable.
   */
  async loadExtract(announcement: AsxAnnouncement, { force = false } = {}): Promise<PluginCacheResult<AnnouncementExtract>> {
    return this.caches.extracts.load(announcement.documentKey, async () => {
      try {
        const bytes = await this.client.fetchPdf(announcement.documentKey);
        const { text, totalPages, pagesRead } = await extractPdfText(bytes, { maxPages: this.maxPdfPages });
        return { text: extractSummary(cleanPdfText(text), { maxChars: this.maxExtractChars }), totalPages, pagesRead };
      } catch (error) {
        throw toExtractUnavailable(error);
      }
    }, { force });
  }
}
