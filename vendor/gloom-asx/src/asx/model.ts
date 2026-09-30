export interface AsxAnnouncement {
  /** Markit document key, e.g. "2924-03118748-2A1688146". Stable id for the PDF. */
  documentKey: string;
  symbol: string;
  companyName: string | null;
  headline: string;
  /** ISO 8601, UTC. Empty when the feed gave no parseable date. */
  releasedAt: string;
  isPriceSensitive: boolean;
  /** ASX announcement type labels, e.g. ["Appendix 3Y"]. Often empty. */
  types: string[];
  pageCount: number | null;
  fileSizeBytes: number | null;
  pdfUrl: string;
}

export interface AnnouncementsPage {
  items: AsxAnnouncement[];
  page: number;
  itemsPerPage: number;
  hasMore: boolean;
  totalItems: number | null;
}

export interface EntityMatch {
  xid: string;
  symbol: string;
  displayName: string | null;
}

export interface AnnouncementExtract {
  /** Cleaned, length-limited text from the first pages of the PDF. */
  text: string;
  totalPages: number;
  pagesRead: number;
}
