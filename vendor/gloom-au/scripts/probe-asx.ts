/**
 * Live check of the undocumented ASX endpoints the announcements view relies on.
 *
 *   bun run probe:asx CBA         # 2 requests: entity lookup, first feed page
 *   bun run probe:asx CBA --pdf   # + 1: the newest own announcement's PDF, then text extraction
 *
 * Run it once after ASX changes something, read the report, fix, run again.
 * It never loops. Ported from gloom-asx's probe.
 */
import { cleanPdfText, extractSummary } from "../announcements/extract/clean";
import { extractPdfText } from "../announcements/extract/pdf-text";
import { entityFeedUrl, parseFeedPage, pickEntity, predictiveSearchUrl } from "../announcements/feed";
import { announcementPdfUrl } from "../announcements/model";
import { fetchBytes, fetchJson } from "../shared/http";

const args = process.argv.slice(2);
const code = (args.find((arg) => !arg.startsWith("--")) ?? "CBA").toUpperCase();
const results: Array<[string, boolean | null, string]> = [];
const check = (id: string, ok: boolean | null, note: string) => results.push([id, ok, note]);

try {
  const search = await fetchJson<unknown>(predictiveSearchUrl(code));
  const entity = pickEntity(search, code);
  check("P1 entity lookup", !!entity, entity ? `${entity.symbol} → xid ${entity.xid} (${entity.displayName ?? "no name"})` : "no exact symbol match");
  if (entity) {
    const page = parseFeedPage(await fetchJson<unknown>(entityFeedUrl(entity.xid, 0)), 0);
    check("P2 feed page", page.items.length > 0, `${page.items.length} items, total ${page.totalItems ?? "unknown"}, hasMore ${page.hasMore}`);
    const newest = page.items[0];
    check("P3 fields", newest ? !!(newest.documentKey && newest.releasedAt && newest.headline) : false,
      newest ? `${new Date(newest.releasedAt).toISOString()} ${newest.code} "${newest.headline}" (${newest.category}, types: ${newest.types.join("; ") || "none"})` : "no items");
    check("P4 other issuers", null, `${page.items.filter((item) => item.code !== code).length} of ${page.items.length} rows lodged by another issuer`);
    const own = page.items.find((item) => item.code === code && item.documentKey);
    if (args.includes("--pdf") && own?.documentKey) {
      const bytes = await fetchBytes(announcementPdfUrl(own.documentKey), "application/pdf, */*");
      check("P5 PDF download", bytes.length > 0, `${bytes.length} bytes, no token`);
      const pdf = await extractPdfText(bytes, { maxPages: 2 });
      const text = extractSummary(cleanPdfText(pdf.text), { maxChars: 300 });
      check("P6 extract", text.length > 0, `${pdf.pagesRead}/${pdf.totalPages} pages: ${text.slice(0, 160)}`);
    }
  }
} catch (error) {
  check("request", false, error instanceof Error ? error.message : String(error));
}

for (const [id, ok, note] of results) console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  ${id}: ${note}`);
process.exit(results.some(([, ok]) => ok === false) ? 1 : 0);
