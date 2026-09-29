import { PAGE_BREAK } from "./summary";

export interface PdfTextResult {
  text: string;
  totalPages: number;
  pagesRead: number;
}

/** The bytes are not a PDF, or were damaged on the way. */
export class PdfUnreadableError extends Error {
  constructor(message = "Not a PDF, or damaged in transit") {
    super(message);
    this.name = "PdfUnreadableError";
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
/** Readers conventionally look for the header in the first 1 KiB. */
const HEADER_WINDOW = 1024;
/**
 * U+FFFD encoded as UTF-8. A transport that carries the body as text (as
 * Gloomberb 0.15.2's desktop and web proxies do) turns every invalid UTF-8
 * sequence in a binary PDF into these, and pdf.js then reads the damaged file
 * as an empty document instead of failing. An intact PDF holds one by chance
 * about once per 16 MB, so a handful means the bytes were decoded on the way.
 */
const REPLACEMENT_CHAR = [0xef, 0xbf, 0xbd];
const MANGLED_THRESHOLD = 8;

function startsAt(bytes: Uint8Array, index: number, pattern: readonly number[]): boolean {
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (bytes[index + offset] !== pattern[offset]) return false;
  }
  return true;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, HEADER_WINDOW) - PDF_MAGIC.length;
  for (let index = 0; index <= end; index += 1) {
    if (startsAt(bytes, index, PDF_MAGIC)) return true;
  }
  return false;
}

function looksTextDecoded(bytes: Uint8Array): boolean {
  let found = 0;
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (!startsAt(bytes, index, REPLACEMENT_CHAR)) continue;
    found += 1;
    if (found >= MANGLED_THRESHOLD) return true;
  }
  return false;
}

/**
 * Text of the first pages of a PDF, one line per text run, with pages
 * separated by `PAGE_BREAK` so the cleaner can recognise running headers.
 * `unpdf` is imported lazily so the terminal's list view never loads pdf.js
 * until an announcement is opened; a browser bundle compiles it in. Its default
 * build carries pdf.js with the worker inlined, so it needs no worker file and
 * runs the same in Bun and in a browser.
 */
export async function extractPdfText(bytes: Uint8Array, { maxPages = 2 }: { maxPages?: number } = {}): Promise<PdfTextResult> {
  if (!hasPdfHeader(bytes) || looksTextDecoded(bytes)) throw new PdfUnreadableError();
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  try {
    const totalPages = pdf.numPages;
    const pagesRead = Math.max(0, Math.min(maxPages, totalPages));
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= pagesRead; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      chunks.push(text);
    }
    return { text: chunks.join(PAGE_BREAK), totalPages, pagesRead };
  } finally {
    // pdf.js exposes destroy() on the API proxy and cleanup() on the worker
    // proxy; unpdf's serverless build hands back the latter.
    const disposable = pdf as unknown as { destroy?: () => Promise<void> | void; cleanup?: () => Promise<void> | void };
    try { await (disposable.destroy ?? disposable.cleanup)?.call(pdf); } catch { /* best effort */ }
  }
}
