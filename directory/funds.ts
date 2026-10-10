import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache } from "../shared/disk-cache";
import { fetchText } from "../shared/http";
import { companiesCodec, type AsxCompany } from "./client";

const LIST_BASE = "https://cdn.cboe.com/data/au/equities/cxatsl/cxa/PROD_CXATSL_";

/** TMX Australia's (formerly Cboe Australia) tradable-securities list; funds are TYPE 3. */
export function parseTradableFunds(text: string): AsxCompany[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.split("|") ?? [];
  const at = (name: string) => header.indexOf(name);
  const codeAt = at("CXACODE");
  const descAt = at("DESC");
  const typeAt = at("TYPE");
  const subtypeAt = at("INSTRUMENTSUBTYPE");
  const micAt = at("MIC");
  if (codeAt < 0 || descAt < 0 || typeAt < 0) throw new Error("Tradable securities list format was not recognised");
  const funds: AsxCompany[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("|");
    if (cells[0] !== "D" || cells[typeAt] !== "3") continue;
    if (micAt >= 0 && cells[micAt] !== "XASX") continue;
    const code = cells[codeAt]?.trim().toUpperCase() ?? "";
    if (!/^[A-Z0-9]{3,6}$/.test(code)) continue;
    const name = (cells[descAt] ?? code)
      .replace(/\s*\[[^\]]*\]\s*$/, "")
      .replace(/\s+(UNITS|ETF UNITS)$/i, " ETF")
      .replace(/\s+/g, " ")
      .trim();
    funds.push({ code, name: name || code, industryGroup: cells[subtypeAt] === "7" ? "ETF" : "Fund", listedOn: null, marketCap: null });
  }
  if (funds.length === 0) throw new Error("Tradable securities list had no funds");
  return funds;
}

function sydneyStamp(ms: number): string {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(ms)).split("-");
  return `${day}_${month}_${year}`;
}

const cache = createDiskCache(CACHE_POLICY.funds, companiesCodec);

/** ETFs and other funds on ASX. The list is dated; weekends and holidays fall back to the last published day. */
export async function loadAsxFunds(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<AsxCompany[]> {
  const result = await cache.load("funds", async (signal) => {
    let lastError: unknown = null;
    for (let back = 0; back < 6; back += 1) {
      try {
        return parseTradableFunds(await fetchText(`${LIST_BASE}${sydneyStamp(Date.now() - back * 86_400_000)}.txt`, signal));
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error("Tradable securities list unavailable");
  }, options);
  return result.data;
}
