import { AsxHttpError } from "./client";
import { PdfUnreadableError } from "./pdf-text";

/**
 * Why an announcement's extract could not be shown. The announcement itself is
 * still listed and its PDF can still be opened; only the inline text is missing.
 */
export type ExtractFailureReason =
  | "too-large"
  | "not-found"
  | "refused"
  | "server"
  | "timeout"
  | "network"
  | "encrypted"
  | "unreadable";

const OPEN_ORIGINAL = "Open the original PDF to view it.";
const RETRY = "Press r to retry, or open the original PDF.";

const MESSAGES: Record<ExtractFailureReason, string> = {
  "too-large": `Inline extract unavailable: this PDF is too large to download here. ${OPEN_ORIGINAL}`,
  "not-found": `Inline extract unavailable: ASX did not find this document's PDF. ${OPEN_ORIGINAL}`,
  refused: `Inline extract unavailable: ASX refused the PDF download. ${OPEN_ORIGINAL}`,
  server: `Inline extract unavailable: the ASX document service returned an error. ${RETRY}`,
  timeout: `Inline extract unavailable: the PDF download timed out. ${RETRY}`,
  network: `Inline extract unavailable: the PDF could not be downloaded. ${RETRY}`,
  encrypted: `Inline extract unavailable: this PDF is encrypted. ${OPEN_ORIGINAL}`,
  unreadable: `Inline extract unavailable for this document. ${OPEN_ORIGINAL}`,
};

/** Only these may succeed on a plain retry; the rest would fail the same way again. */
const TRANSIENT: ReadonlySet<ExtractFailureReason> = new Set(["server", "timeout", "network"]);

/** An extract failure, with a message fit to show in place of the extract. */
export class ExtractUnavailableError extends Error {
  constructor(readonly reason: ExtractFailureReason, options?: { cause?: unknown }) {
    super(MESSAGES[reason], options);
    this.name = "ExtractUnavailableError";
  }

  get transient(): boolean {
    return TRANSIENT.has(this.reason);
  }
}

function reasonForStatus(status: number): ExtractFailureReason {
  if (status === 413) return "too-large";
  if (status === 404 || status === 410) return "not-found";
  if (status === 401 || status === 403) return "refused";
  if (status === 408 || status === 504) return "timeout";
  return status >= 500 || status === 429 ? "server" : "unreadable";
}

/** What `createThrottledFetch` retries, plus the browsers' and Bun's words for a failed fetch. */
const NETWORK_FAILURE = /ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|failed to fetch|networkerror|load failed|unable to connect|socket hang up|connection (closed|reset|refused)/i;

/**
 * Classifies whatever the download or pdf.js threw. Gloomberb's web transport
 * throws `Plugin request was refused (<status>). {"error": ...}` when its own
 * proxy turns a request down; apart from a body over its size limit and an
 * upstream timeout, those say nothing about the document (the session is
 * signed out, the host is not proxied, ASX could not be reached), so they
 * count as a failed download.
 */
export function classifyExtractFailure(error: unknown): ExtractFailureReason {
  if (error instanceof ExtractUnavailableError) return error.reason;
  if (error instanceof AsxHttpError) return reasonForStatus(error.status);
  if (error instanceof PdfUnreadableError) return "unreadable";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException") return "encrypted";
  if (/Plugin request was refused/.test(message)) {
    if (/too large/i.test(message)) return "too-large";
    return /timed out/i.test(message) ? "timeout" : "network";
  }
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (error instanceof TypeError || NETWORK_FAILURE.test(message)) return "network";
  return "unreadable";
}

export function toExtractUnavailable(error: unknown): ExtractUnavailableError {
  return error instanceof ExtractUnavailableError ? error : new ExtractUnavailableError(classifyExtractFailure(error), { cause: error });
}
