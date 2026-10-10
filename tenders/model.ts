export interface Contract {
  /** AusTender contract notice id, e.g. CN4280996. */
  id: string;
  publishedAt: number;
  agency: string;
  supplier: string;
  supplierAbn: string | null;
  /** AUD. */
  value: number | null;
  description: string;
  start: string | null;
  end: string | null;
  procurementMethod: string | null;
}

interface Party {
  name?: unknown;
  roles?: unknown;
  additionalIdentifiers?: Array<{ id?: unknown; scheme?: unknown }>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One OCDS release package from api.tenders.gov.au. Each release carries the
 * contract, its supplier and the procuring agency as parties. Amendments
 * share a contract id; the latest release wins.
 */
export function parseOcdsPage(payload: unknown): { contracts: Contract[]; next: string | null } {
  const releases = (payload as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(releases)) throw new Error("AusTender data format was not recognised");
  const contracts: Contract[] = [];
  for (const release of releases as Array<Record<string, any>>) {
    const parties = (Array.isArray(release.parties) ? release.parties : []) as Party[];
    const role = (name: string) => parties.find((party) => Array.isArray(party.roles) && party.roles.includes(name));
    const supplier = role("supplier");
    const agency = role("procuringEntity");
    for (const contract of (Array.isArray(release.contracts) ? release.contracts : []) as Array<Record<string, any>>) {
      const id = text(contract.id);
      const publishedAt = Date.parse(text(release.date) || text(contract.dateSigned));
      if (!id || !Number.isFinite(publishedAt)) continue;
      const amount = Number(contract.value?.amount);
      const abn = supplier?.additionalIdentifiers?.find((identifier) => identifier.scheme === "AU-ABN")?.id;
      contracts.push({
        id,
        publishedAt,
        agency: text(agency?.name),
        supplier: text(supplier?.name),
        supplierAbn: typeof abn === "string" && abn ? abn : null,
        value: Number.isFinite(amount) ? amount : null,
        description: text(contract.description) || text(contract.title),
        start: text(contract.period?.startDate).slice(0, 10) || null,
        end: text(contract.period?.endDate).slice(0, 10) || null,
        procurementMethod: text(release.tender?.procurementMethodDetails) || null,
      });
    }
  }
  const next = (payload as { links?: { next?: unknown } }).links?.next;
  return { contracts, next: typeof next === "string" && next ? next : null };
}

/** Latest release per contract id. */
export function dedupeContracts(contracts: readonly Contract[]): Contract[] {
  const byId = new Map<string, Contract>();
  for (const contract of contracts) {
    const existing = byId.get(contract.id);
    if (!existing || contract.publishedAt >= existing.publishedAt) byId.set(contract.id, contract);
  }
  return [...byId.values()];
}

const NOISE = /\b(PTY|PROPRIETARY|LTD|LIMITED|INC|CORP|CORPORATION|CO|COMPANY|GROUP|HOLDINGS?|AUSTRALIA|AUSTRALIAN|AUST|PLC|NL|THE|AND|SERVICES|OPERATIONS)\b/g;

/** A company name reduced to its distinctive words, for matching suppliers with ASX issuers. */
export function nameKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ASX code per supplier name key. Keys of three characters or fewer, or
 * shared by two issuers, are dropped: they match too much.
 */
export function buildIssuerIndex(companies: ReadonlyArray<{ code: string; name: string }>): Map<string, string> {
  const index = new Map<string, string>();
  const clashes = new Set<string>();
  for (const company of companies) {
    const key = nameKey(company.name);
    if (key.length <= 3) continue;
    if (index.has(key) && index.get(key) !== company.code) clashes.add(key);
    index.set(key, company.code);
  }
  for (const key of clashes) index.delete(key);
  return index;
}

/**
 * The ASX code for a supplier: its whole name, or failing that its leading
 * words (a subsidiary such as "ResMed Asia Pacific" under "ResMed"). Leading
 * words must make at least five characters, so a generic first word alone
 * never matches.
 */
/** Single words too common in company names to identify one on their own. */
const GENERIC_WORDS = new Set([
  "ENVIRONMENTAL", "GLOBAL", "NATIONAL", "INTERNATIONAL", "ENERGY", "RESOURCES", "MEDICAL", "HEALTH", "HEALTHCARE",
  "CAPITAL", "INVESTMENTS", "TECHNOLOGY", "TECHNOLOGIES", "SYSTEMS", "SOLUTIONS", "CONSULTING", "PROPERTY",
  "INFRASTRUCTURE", "ENGINEERING", "MINING", "MINERALS", "DIGITAL", "SECURITY", "PACIFIC", "SOUTHERN", "NORTHERN",
  "WESTERN", "EASTERN", "METALS", "GOLD", "LITHIUM", "URANIUM", "FINANCIAL", "INSURANCE", "LOGISTICS", "TRANSPORT",
  "CONSTRUCTION", "INDUSTRIES", "PARTNERS", "MANAGEMENT", "NETWORKS", "COMMUNICATIONS", "SOFTWARE", "LABS",
]);

export function matchIssuer(index: ReadonlyMap<string, string>, supplier: string): string | null {
  const key = nameKey(supplier);
  if (!key) return null;
  const exact = index.get(key);
  if (exact) return exact;
  const words = key.split(" ");
  for (let count = words.length - 1; count >= 1; count -= 1) {
    const prefix = words.slice(0, count).join(" ");
    if (prefix.length < 5) break;
    if (count === 1 && GENERIC_WORDS.has(prefix)) break;
    const code = index.get(prefix);
    if (code) return code;
  }
  return null;
}

export type ContractWindow = "1D" | "3D" | "7D";
export const WINDOW_DAYS: Record<ContractWindow, number> = { "1D": 1, "3D": 3, "7D": 7 };
