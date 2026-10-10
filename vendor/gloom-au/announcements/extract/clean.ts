/**
 * Turns the raw text of an announcement PDF into a readable extract: strips
 * the ASX watermark, running headers and page counters, rebuilds paragraphs
 * from PDF lines, and cuts to whole sentences. Ported from gloom-asx.
 */
const WATERMARK = /for\s*personal\s*use\s*only/gi;
const PAGE_MARKER = /^(page\s+)?\d+(\s+of\s+\d+)?$/i;
const ENDS_SENTENCE = /[.!?:]["')\]]?$/;

/** `extractPdfText` separates pages with a form feed so page furniture can be recognised. */
export const PAGE_BREAK = "\f";
const HEADER_ZONE = 300;
const MIN_HEADER_WORDS = 3;
const MIN_HEADER_CHARS = 15;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function withoutLeadingWords(page: string, words: readonly string[]): string {
  return page.replace(new RegExp(`^\\s*${words.map(escapeRegExp).join("\\s+")}`), "");
}

/**
 * Removes running headers and "n / m" page counters. Form-style PDFs such as
 * Appendix 3A.1 print "Appendix 3A.1 - Notification of dividend / distribution"
 * twice at the top of every page, followed by "1 / 7", "2 / 7" and so on.
 */
function stripPageFurniture(pages: string[]): string[] {
  const cleaned = pages.map((page, index) => {
    // Only the page's own number, near its top, so "50 / 50" in the body survives.
    const counter = new RegExp(`(^|\\s)${index + 1}\\s*/\\s*\\d+(?=\\s|$)`);
    const head = page.slice(0, HEADER_ZONE).replace(counter, "$1");
    // A heading printed twice in a row: keep one copy.
    return (head + page.slice(HEADER_ZONE)).replace(/^\s*(\S.{14,199}?)\s+\1(?=\s|$)/s, "$1");
  });
  const firstWords = cleaned[0]?.trim().split(/\s+/) ?? [];
  return cleaned.map((page, index) => {
    if (index === 0) return page;
    const words = page.trim().split(/\s+/);
    let shared = 0;
    while (shared < firstWords.length && shared < words.length && firstWords[shared] === words[shared]) shared += 1;
    const header = firstWords.slice(0, shared);
    return shared >= MIN_HEADER_WORDS && header.join(" ").length >= MIN_HEADER_CHARS ? withoutLeadingWords(page, header) : page;
  });
}

/** Strips the ASX watermark and layout noise, and rebuilds paragraphs from PDF lines. */
export function cleanPdfText(raw: string): string {
  const pages = stripPageFurniture(raw.replace(WATERMARK, "").split(PAGE_BREAK));
  const lines = pages.join("\n").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
  };
  for (const line of lines) {
    if (!line) { flush(); continue; }
    if (PAGE_MARKER.test(line)) continue;
    current.push(line);
    if (ENDS_SENTENCE.test(line)) flush();
  }
  flush();
  return paragraphs.join("\n").trim();
}

const SENTENCE_END = /[.!?]["')\]]?(?=\s|$)/g;

/** The first whole sentences that fit; a lone run-on sentence is hard-cut. */
export function extractSummary(text: string, { maxChars = 1500 }: { maxChars?: number } = {}): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const budget = maxChars - 2; // room for " …"
  let cut = 0;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (end > budget) break;
    cut = end;
  }
  if (cut === 0) return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
  return `${trimmed.slice(0, cut).trimEnd()} …`;
}
