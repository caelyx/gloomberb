import { createThrottledFetch } from "gloomberb/utils";
import { cachedAsxDirectory, loadAsxDirectory } from "../directory/client";
import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectArray, expectNumber, expectString, nullableNumber, nullableString, type CacheMeta, type DiskCodec } from "../shared/disk-cache";
import { USER_AGENT } from "../shared/http";
import { WINDOW_DAYS, buildIssuerIndex, dedupeContracts, matchIssuer, parseOcdsPage, type Contract, type ContractWindow } from "./model";

const OCDS = "https://api.tenders.gov.au/ocds/findByDates/contractPublished";
const client = createThrottledFetch({ requestsPerMinute: 60, maxRetries: 2, timeoutMs: 30_000, defaultHeaders: { "User-Agent": USER_AGENT } });

type StoredContract = [id: string, publishedAt: number, agency: string, supplier: string, supplierAbn: string | null, value: number | null, description: string, start: string | null, end: string | null, procurementMethod: string | null];
interface Window { contracts: Contract[]; complete: boolean }

export const contractsCodec: DiskCodec<Window, { complete: boolean; contracts: StoredContract[] }> = {
  encode: (window) => ({
    complete: window.complete,
    contracts: window.contracts.map((c) => [c.id, c.publishedAt, c.agency, c.supplier, c.supplierAbn, c.value, c.description, c.start, c.end, c.procurementMethod]),
  }),
  decode: (stored) => {
    if (typeof stored?.complete !== "boolean") throw new Error("Cached AusTender window is incomplete");
    return {
      complete: stored.complete,
      contracts: expectArray(stored.contracts, "contracts").map((entry): Contract => {
        const [id, publishedAt, agency, supplier, supplierAbn, value, description, start, end, procurementMethod] = expectArray(entry, "contract");
        return {
          id: expectString(id, "contract id"),
          publishedAt: expectNumber(publishedAt, "published date"),
          agency: expectString(agency, "agency"),
          supplier: expectString(supplier, "supplier"),
          supplierAbn: nullableString(supplierAbn, "ABN"),
          value: nullableNumber(value, "value"),
          description: expectString(description, "description"),
          start: nullableString(start, "start"),
          end: nullableString(end, "end"),
          procurementMethod: nullableString(procurementMethod, "procurement method"),
        };
      }),
    };
  },
};

/** One entry per window, kept on disk; see CACHE_POLICY.contracts. */
const cache = createDiskCache(CACHE_POLICY.contracts, contractsCodec);

/** Enough for a busy week; beyond it the window is reported as incomplete. */
const MAX_PAGES = 60;

export interface ContractList {
  contracts: Array<Contract & { asxCode: string | null }>;
  complete: boolean;
  meta: CacheMeta;
}

function withIssuers(window: Window, directory: Parameters<typeof buildIssuerIndex>[0], meta: CacheMeta): ContractList {
  const index = buildIssuerIndex(directory);
  return {
    contracts: window.contracts.map((contract) => ({ ...contract, asxCode: matchIssuer(index, contract.supplier) })),
    complete: window.complete,
    meta,
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await client.fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`AusTender request failed (${response.status})`);
  return response.json();
}

/** Contracts published over the window, with ASX-listed suppliers matched by name. */
export async function loadContracts(window: ContractWindow, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ContractList> {
  const { data, ...meta } = await cache.load(window, async (signal) => {
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS[window] * 86_400_000);
    let url: string | null = `${OCDS}/${start.toISOString().slice(0, 19)}Z/${end.toISOString().slice(0, 19)}Z`;
    const collected: Contract[] = [];
    let pages = 0;
    while (url && pages < MAX_PAGES) {
      const page = parseOcdsPage(await fetchJson(url, signal));
      collected.push(...page.contracts);
      url = page.next;
      pages += 1;
    }
    return { contracts: dedupeContracts(collected), complete: url === null };
  }, options);
  return withIssuers(data, await loadAsxDirectory().catch(() => []), meta);
}

/** A window on disk, for a pane's first paint. */
export function cachedContracts(window: ContractWindow): ContractList | null {
  const cached = cache.peek(window);
  return cached ? withIssuers(cached.data, cachedAsxDirectory() ?? [], cached) : null;
}
