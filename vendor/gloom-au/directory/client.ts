import { CACHE_POLICY } from "../shared/cache-policy";
import { parseCsvLine } from "../shared/csv";
import { createDiskCache, expectArray, expectString, nullableNumber, nullableString, type DiskCodec } from "../shared/disk-cache";
import { fetchText } from "../shared/http";

/** The ASX company directory with listing date and market cap. */
export const ASX_DIRECTORY_URL = "https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file";
/** ASX's own listed-companies CSV: code, name and GICS group only. The fallback. */
export const ASX_LISTED_COMPANIES_URL = "https://www.asx.com.au/asx/research/ASXListedCompanies.csv";

export interface AsxCompany {
  code: string;
  name: string;
  /** GICS industry group, or null for trusts and funds ASX files as "Not Applic". */
  industryGroup: string | null;
  /** ISO date. */
  listedOn: string | null;
  /** AUD. */
  marketCap: number | null;
}

function industryGroup(value: string | undefined): string | null {
  const text = value?.trim();
  return !text || /^not appl/i.test(text) ? null : text;
}

/** `dd/mm/yyyy` to ISO, or null. */
function isoDate(value: string | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
}

/**
 * Either CSV, recognised by its header row. Rows without a valid code are
 * skipped, so a preamble line or a trailing blank never becomes a company.
 */
export function parseAsxDirectoryCsv(text: string): AsxCompany[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /asx code/i.test(line));
  if (headerIndex < 0) throw new Error("ASX company list format was not recognised");
  const header = parseCsvLine(lines[headerIndex]!).map((cell) => cell.toLowerCase());
  const column = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));
  const codeAt = column(/asx code/);
  const nameAt = column(/company name/);
  const groupAt = column(/industry group/);
  const listedAt = column(/listing date/);
  const capAt = column(/market cap/);
  const companies: AsxCompany[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const code = cells[codeAt]?.toUpperCase() ?? "";
    if (!/^[A-Z0-9]{3,6}$/.test(code)) continue;
    const cap = capAt >= 0 ? Number(cells[capAt]) : Number.NaN;
    companies.push({
      code,
      // ASX pads a few names with dots ("ZIP CO LIMITED..").
      name: (cells[nameAt] ?? code).replace(/\.{2,}$/, "").trim() || code,
      industryGroup: industryGroup(cells[groupAt]),
      listedOn: listedAt >= 0 ? isoDate(cells[listedAt]) : null,
      marketCap: Number.isFinite(cap) && cap > 0 ? cap : null,
    });
  }
  if (companies.length === 0) throw new Error("ASX company list was empty");
  return companies;
}

type StoredCompany = [code: string, name: string, industryGroup: string | null, listedOn: string | null, marketCap: number | null];

/** Companies as rows of five, for the directory and the fund list. */
export const companiesCodec: DiskCodec<AsxCompany[], StoredCompany[]> = {
  encode: (companies) => companies.map((company) => [company.code, company.name, company.industryGroup, company.listedOn, company.marketCap]),
  decode: (stored) => {
    const companies = expectArray(stored, "company list").map((entry): AsxCompany => {
      const [code, name, industryGroup, listedOn, marketCap] = expectArray(entry, "company");
      return {
        code: expectString(code, "company code"),
        name: expectString(name, "company name"),
        industryGroup: nullableString(industryGroup, "industry group"),
        listedOn: nullableString(listedOn, "listing date"),
        marketCap: nullableNumber(marketCap, "market cap"),
      };
    });
    if (companies.length === 0) throw new Error("Cached company list is empty");
    return companies;
  },
};

/** Kept on disk: search, AusTender supplier matching, short-position names and the heatmap all read it. */
const cache = createDiskCache(CACHE_POLICY.directory, companiesCodec);

/** The directory, refreshed twice a day; the official list when the directory fails. */
export async function loadAsxDirectory(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<AsxCompany[]> {
  const result = await cache.load("directory", async (signal) => {
    try {
      return parseAsxDirectoryCsv(await fetchText(ASX_DIRECTORY_URL, signal));
    } catch (error) {
      if (signal.aborted) throw error;
      return parseAsxDirectoryCsv(await fetchText(ASX_LISTED_COMPANIES_URL, signal));
    }
  }, options);
  return result.data;
}

/** The directory on hand, without fetching. */
export function cachedAsxDirectory(): AsxCompany[] | null {
  return cache.peek("directory")?.data ?? null;
}

/**
 * Code matches first (exact, then prefix), then names by word prefix, larger
 * companies first within each tier.
 */
export function searchAsxDirectory(companies: readonly AsxCompany[], query: string, limit = 8): AsxCompany[] {
  const needle = query.trim().toUpperCase().replace(/\.AX$/, "");
  if (!needle) return [];
  const words = needle.split(/\s+/).filter(Boolean);
  const scored: Array<{ company: AsxCompany; tier: number }> = [];
  for (const company of companies) {
    const name = company.name.toUpperCase();
    let tier = -1;
    if (company.code === needle) tier = 0;
    else if (company.code.startsWith(needle)) tier = 1;
    else if (name.startsWith(needle)) tier = 2;
    else if (words.every((word) => name.split(/[\s.&,()-]+/).some((part) => part.startsWith(word)))) tier = 3;
    if (tier >= 0) scored.push({ company, tier });
  }
  scored.sort((a, b) => a.tier - b.tier
    || (b.company.marketCap ?? 0) - (a.company.marketCap ?? 0)
    || a.company.code.localeCompare(b.company.code));
  return scored.slice(0, limit).map((entry) => entry.company);
}

const PREDICTIVE_URL = "https://asx.api.markitdigital.com/asx-research/1.0/search/predictive";

const ISSUE_TYPES: Record<string, string> = { ETF: "ETF", CS: "", MF: "Fund", TR: "Trust", PS: "Preference", ST: "Stapled" };

/** ASX's own predictive search (the asx.com.au search box): full names for funds as well as companies. */
export function parsePredictiveSearch(payload: unknown): AsxCompany[] {
  const items = (payload as { data?: { items?: unknown } } | null)?.data?.items;
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new Error("ASX search format was not recognised");
  return (items as Array<Record<string, unknown>>).flatMap((item) => {
    const code = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{3,6}$/.test(code)) return [];
    const type = typeof item.issueType === "string" ? item.issueType : "";
    const cap = typeof item.marketCap === "number" && item.marketCap > 0 ? item.marketCap : null;
    return [{
      code,
      name: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim() : code,
      industryGroup: ISSUE_TYPES[type] || null,
      listedOn: null,
      marketCap: cap,
    }];
  });
}

export async function searchAsx(query: string, signal?: AbortSignal): Promise<AsxCompany[]> {
  const url = `${PREDICTIVE_URL}?${new URLSearchParams({ searchText: query.trim().replace(/\.AX$/i, "") })}`;
  return parsePredictiveSearch(JSON.parse(await fetchText(url, signal)));
}
