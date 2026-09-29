/**
 * Live probe for the Markit Digital endpoints behind asx.com.au.
 *
 *   bun run probe CBA            # 2 requests: entity lookup + first page
 *   bun run probe CBA --pdf      # + 1 request: newest announcement's PDF, then text extraction
 *   bun run probe CBA --alt-url  # + 1 request: JSON-array form of entityXids
 *   bun run probe CBA --pdf --token <access_token>
 *
 * It drives the production AsxClient through a recording transport, so what
 * it exercises is exactly what the plugin sends. Raw responses are written to
 * docs/research/samples/ for the next step (promoting them to test fixtures).
 *
 * Be polite: run it once, read the report, change code, run it again. It
 * never loops and never retries beyond the client's own 429/5xx policy.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AsxClient, AsxHttpError, USER_AGENT } from "../src/asx/client";
import { parseAnnouncementsPage, parsePredictiveSearch, pickEntityForCode } from "../src/asx/parse";
import { extractPdfText } from "../src/asx/pdf-text";
import { cleanPdfText, extractSummary } from "../src/asx/summary";
import { announcementsUrl } from "../src/asx/urls";

const args = process.argv.slice(2);
const code = (args.find((arg) => !arg.startsWith("--")) ?? "CBA").toUpperCase();
const wantPdf = args.includes("--pdf");
const wantAltUrl = args.includes("--alt-url");
const tokenIndex = args.indexOf("--token");
const accessToken = tokenIndex >= 0 ? args[tokenIndex + 1] ?? null : null;
const ITEMS_PER_PAGE = 10;
const PAUSE_MS = 1_500;
const samplesDir = join(import.meta.dir, "..", "docs", "research", "samples");

interface Recorded { url: string; status: number; headers: Record<string, string>; body: Uint8Array; ms: number }
const recorded: Recorded[] = [];
const checks: Array<{ id: string; result: "PASS" | "FAIL" | "INFO" | "SKIP"; note: string }> = [];
const check = (id: string, result: "PASS" | "FAIL" | "INFO" | "SKIP", note: string) => checks.push({ id, result, note });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let requestCount = 0;
async function recordingTransport(url: string, init?: RequestInit): Promise<Response> {
  if (requestCount > 0) await sleep(PAUSE_MS);
  requestCount += 1;
  const started = Date.now();
  console.log(`\n→ GET ${url}`);
  const response = await fetch(url, init);
  const body = new Uint8Array(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  recorded.push({ url, status: response.status, headers, body, ms: Date.now() - started });
  console.log(`← ${response.status} ${response.headers.get("content-type") ?? ""} ${body.byteLength} bytes in ${Date.now() - started} ms`);
  for (const [key, value] of Object.entries(headers)) {
    if (/ratelimit|retry-after|cf-ray|server|x-cache|cache-control/i.test(key)) console.log(`   ${key}: ${value}`);
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function decodeJson(body: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}

function keysOf(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as object) : [];
}

async function save(name: string, body: Uint8Array | string, extra?: Record<string, unknown>) {
  await mkdir(samplesDir, { recursive: true });
  const path = join(samplesDir, name);
  await writeFile(path, body);
  if (extra) await writeFile(`${path}.meta.json`, JSON.stringify(extra, null, 2));
  console.log(`   saved ${path}`);
}

console.log(`gloom-asx live probe for ${code}\nUser-Agent: ${USER_AGENT}\nRequests planned: ${2 + (wantPdf ? 1 : 0) + (wantAltUrl ? 1 : 0)}`);

const client = new AsxClient({ transport: recordingTransport, itemsPerPage: ITEMS_PER_PAGE, accessToken, maxRetries: 1 });

// 1. Entity lookup
let xid: string | null = null;
try {
  const entity = await client.lookupEntity(code);
  xid = entity.xid;
  check("L1", "PASS", `predictive search resolved ${code} to xid ${entity.xid} (${entity.displayName ?? "no display name"})`);
} catch (error) {
  check("L1", "FAIL", `lookupEntity threw: ${error instanceof Error ? error.message : String(error)}`);
}
const predictiveRaw = recorded[0];
if (predictiveRaw) {
  const json = decodeJson(predictiveRaw.body);
  await save(`${code}-predictive.json`, JSON.stringify(json, null, 2), { url: predictiveRaw.url, status: predictiveRaw.status, headers: predictiveRaw.headers });
  const data = (json as { data?: unknown })?.data;
  const items = (data as { items?: unknown[] })?.items;
  check("L2", Array.isArray(items) ? "PASS" : "FAIL", `predictive top-level keys ${JSON.stringify(keysOf(json))}; data keys ${JSON.stringify(keysOf(data))}; first item keys ${JSON.stringify(keysOf(items?.[0]))}`);
  const matches = parsePredictiveSearch(json);
  check("L3", pickEntityForCode(matches, code) ? "PASS" : "FAIL", `parser found ${matches.length} entities: ${matches.map((m) => `${m.symbol || "?"}=${m.xid}`).join(", ")}`);
}

// 2. First page of announcements
if (xid) {
  try {
    const page = await client.fetchAnnouncementsPage(xid, 0);
    const raw = recorded[recorded.length - 1]!;
    const json = decodeJson(raw.body);
    await save(`${code}-announcements-page0.json`, JSON.stringify(json, null, 2), { url: raw.url, status: raw.status, headers: raw.headers });
    const data = (json as { data?: unknown })?.data;
    const items = (data as { items?: unknown[] })?.items;
    check("L4", Array.isArray(items) ? "PASS" : "FAIL", `announcements top-level keys ${JSON.stringify(keysOf(json))}; data keys ${JSON.stringify(keysOf(data))}`);
    check("L5", "INFO", `first raw item keys ${JSON.stringify(keysOf(items?.[0]))}`);
    check("L6", page.items.length > 0 ? "PASS" : "FAIL", `parser produced ${page.items.length} of ${items?.length ?? 0} raw items; hasMore=${page.hasMore}; totalItems=${page.totalItems}`);
    const first = page.items[0];
    if (first) {
      const missing = [
        !first.releasedAt && "releasedAt", !first.symbol && "symbol", first.companyName === null && "companyName",
        first.types.length === 0 && "types", first.pageCount === null && "pageCount", first.fileSizeBytes === null && "fileSizeBytes",
      ].filter(Boolean);
      check("L7", first.releasedAt ? "PASS" : "FAIL", `newest: ${first.releasedAt} ${first.isPriceSensitive ? "$" : " "} ${first.headline} [${first.types.join(", ")}] key=${first.documentKey}; unmapped or empty: ${missing.length ? missing.join(", ") : "none"}`);
      check("L8", "INFO", `parsed pdfUrl: ${first.pdfUrl}`);
      const sorted = page.items.every((item, index) => index === 0 || item.releasedAt <= page.items[index - 1]!.releasedAt);
      check("L9", sorted ? "PASS" : "FAIL", "items are newest first after parsing");
      const priceSensitiveSeen = page.items.some((item) => item.isPriceSensitive);
      check("L10", "INFO", priceSensitiveSeen ? "at least one item parsed as price sensitive" : "no item parsed as price sensitive in this page: check the flag's real field name in L5");
    }

    // 3. PDF and extract
    if (wantPdf && first) {
      try {
        const bytes = await client.fetchPdf(first.documentKey);
        const raw = recorded[recorded.length - 1]!;
        const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
        await save(`${code}-${first.documentKey}.pdf`, bytes, { url: raw.url, status: raw.status, headers: raw.headers });
        check("L11", isPdf ? "PASS" : "FAIL", `PDF fetch ${accessToken ? "with" : "without"} access_token: ${bytes.byteLength} bytes, content-type ${raw.headers["content-type"] ?? "?"}, %PDF magic ${isPdf ? "present" : "absent"}`);
        if (isPdf) {
          const { text, totalPages, pagesRead } = await extractPdfText(bytes, { maxPages: 2 });
          const summary = extractSummary(cleanPdfText(text), { maxChars: 600 });
          check("L12", summary.length > 40 ? "PASS" : "FAIL", `extracted ${text.length} chars from ${pagesRead}/${totalPages} pages; watermark ${/personal use only/i.test(summary) ? "STILL PRESENT" : "removed"}`);
          console.log(`\n--- extract preview ---\n${summary}\n--- end preview ---`);
        }
      } catch (error) {
        const hint = error instanceof AsxHttpError && (error.status === 401 || error.status === 403) && !accessToken
          ? " (try again with --token <access_token>; see docs/live-testing.md)" : "";
        check("L11", "FAIL", `fetchPdf threw: ${error instanceof Error ? error.message : String(error)}${hint}`);
      }
    } else {
      check("L11", "SKIP", "pass --pdf to fetch the newest announcement's PDF");
    }

    // 4. Alternative query form
    if (wantAltUrl) {
      const alt = announcementsUrl({ xid, page: 0, itemsPerPage: ITEMS_PER_PAGE }).replace(`entityXids[]=${encodeURIComponent(xid)}`, `entityXids=${encodeURIComponent(`[${xid}]`)}`);
      const response = await recordingTransport(alt, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
      const json = decodeJson(new Uint8Array(await response.arrayBuffer()));
      const altPage = parseAnnouncementsPage(json, { page: 0, itemsPerPage: ITEMS_PER_PAGE });
      check("L13", response.ok ? "INFO" : "FAIL", `entityXids=[xid] form: HTTP ${response.status}, ${altPage.items.length} items (compare with L6; both forms may work)`);
    }
  } catch (error) {
    check("L4", "FAIL", `fetchAnnouncementsPage threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\n==== report ====");
for (const { id, result, note } of checks) console.log(`${result.padEnd(4)} ${id.padEnd(4)} ${note}`);
console.log(`\n${requestCount} request(s) made. Raw captures in ${samplesDir}`);
process.exit(checks.some((c) => c.result === "FAIL") ? 1 : 0);
