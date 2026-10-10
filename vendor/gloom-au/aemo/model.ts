/** NEM times are market time: Australian Eastern Standard Time all year (UTC+10, no daylight saving). */
export function nemTimeToUtc(value: string): number | null {
  const ms = Date.parse(`${value.trim()}+10:00`);
  return Number.isFinite(ms) ? ms : null;
}

export const NEM_REGIONS: Record<string, string> = {
  NSW1: "New South Wales",
  QLD1: "Queensland",
  VIC1: "Victoria",
  SA1: "South Australia",
  TAS1: "Tasmania",
};

export interface RegionNow {
  region: string;
  at: number;
  /** $/MWh. */
  price: number;
  /** MW. */
  demand: number | null;
  status: string;
}

export interface MarketNotice {
  id: number;
  at: number;
  type: string;
  title: string;
}

/** FCAS markets in ELEC_NEM_SUMMARY_PRICES, in AEMO's order: regulation, then contingency by speed. */
export const FCAS_SERVICES = [
  { key: "RAISEREGRRP", label: "Raise regulation" },
  { key: "LOWERREGRRP", label: "Lower regulation" },
  { key: "RAISE1SECRRP", label: "Raise 1 second" },
  { key: "RAISE6SECRRP", label: "Raise 6 second" },
  { key: "RAISE60SECRRP", label: "Raise 60 second" },
  { key: "RAISE5MINRRP", label: "Raise 5 minute" },
  { key: "LOWER1SECRRP", label: "Lower 1 second" },
  { key: "LOWER6SECRRP", label: "Lower 6 second" },
  { key: "LOWER60SECRRP", label: "Lower 60 second" },
  { key: "LOWER5MINRRP", label: "Lower 5 minute" },
] as const;

export type FcasService = (typeof FCAS_SERVICES)[number]["key"];

/** One region's FCAS prices for the latest interval, $/MW/h. */
export interface RegionFcas {
  region: string;
  prices: Record<FcasService, number | null>;
}

export interface NemSummary {
  regions: RegionNow[];
  notices: MarketNotice[];
  fcas: RegionFcas[];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseNemSummary(payload: unknown): NemSummary {
  const data = payload as Record<string, unknown> | null;
  const rows = data?.ELEC_NEM_SUMMARY;
  if (!Array.isArray(rows)) throw new Error("AEMO summary format was not recognised");
  const regions = (rows as Array<Record<string, unknown>>).flatMap((row) => {
    const region = typeof row.REGIONID === "string" ? row.REGIONID : "";
    const at = typeof row.SETTLEMENTDATE === "string" ? nemTimeToUtc(row.SETTLEMENTDATE) : null;
    const price = num(row.PRICE);
    return region && at != null && price != null
      ? [{ region, at, price, demand: num(row.TOTALDEMAND), status: typeof row.PRICE_STATUS === "string" ? row.PRICE_STATUS : "" }]
      : [];
  });
  const notices = (Array.isArray(data?.ELEC_NEM_SUMMARY_MARKET_NOTICE) ? data!.ELEC_NEM_SUMMARY_MARKET_NOTICE as Array<Record<string, unknown>> : [])
    .flatMap((row) => {
      const at = typeof row.EFFECTIVEDATE === "string" ? nemTimeToUtc(row.EFFECTIVEDATE) : null;
      const id = num(row.NOTICEID);
      const title = typeof row.EXTERNALREFERENCE === "string" ? row.EXTERNALREFERENCE.trim() : "";
      return at != null && id != null && title ? [{ id, at, type: typeof row.TYPEID === "string" ? row.TYPEID : "", title }] : [];
    })
    .sort((a, b) => b.at - a.at);
  // FCAS is context; a summary without it still stands.
  const fcas = (Array.isArray(data?.ELEC_NEM_SUMMARY_PRICES) ? data!.ELEC_NEM_SUMMARY_PRICES as Array<Record<string, unknown>> : [])
    .flatMap((row) => {
      const region = typeof row.REGIONID === "string" ? row.REGIONID : "";
      if (!region) return [];
      const prices = Object.fromEntries(FCAS_SERVICES.map((service) => [service.key, num(row[service.key])])) as RegionFcas["prices"];
      return [{ region, prices }];
    });
  return { regions, notices, fcas };
}

export interface PricePoint {
  region: string;
  at: number;
  price: number;
  actual: boolean;
  /** MW; the 5-minute report only. */
  demand?: number;
}

/** The 5-minute report: actual dispatch prices (with demand) and the pre-dispatch forecast. */
export function parseFiveMinute(payload: unknown): PricePoint[] {
  const rows = (payload as { "5MIN"?: unknown } | null)?.["5MIN"];
  if (!Array.isArray(rows)) throw new Error("AEMO price report format was not recognised");
  return (rows as Array<Record<string, unknown>>).flatMap((row) => {
    const region = typeof row.REGIONID === "string" ? row.REGIONID : "";
    const at = typeof row.SETTLEMENTDATE === "string" ? nemTimeToUtc(row.SETTLEMENTDATE) : null;
    const price = num(row.RRP);
    const demand = num(row.TOTALDEMAND);
    return region && at != null && price != null
      ? [{ region, at, price, actual: row.PERIODTYPE === "ACTUAL", ...(demand != null ? { demand } : {}) }]
      : [];
  });
}

/**
 * The dashboard's cumulative price report: every region's 5-minute price over
 * the last seven days (`A` 1), then the pre-dispatch forecast (`A` 0).
 */
export function parseCumulativePrice(payload: unknown): PricePoint[] {
  const rows = (payload as { NEM_DASHBOARD_CUMUL_PRICE?: unknown } | null)?.NEM_DASHBOARD_CUMUL_PRICE;
  if (!Array.isArray(rows)) throw new Error("AEMO price history format was not recognised");
  return (rows as Array<Record<string, unknown>>).flatMap((row) => {
    const region = typeof row.R === "string" ? row.R : "";
    const at = typeof row.DT === "string" ? nemTimeToUtc(row.DT) : null;
    const price = num(row.P);
    return region && at != null && price != null ? [{ region, at, price, actual: row.A === 1 }] : [];
  });
}

export interface RegionDay {
  average: number | null;
  low: number | null;
  high: number | null;
  /** Share of 5-minute intervals at or below zero. */
  negativeShare: number | null;
}

/** Actual prices for one region over the last 24 hours. */
export function regionDay(points: readonly PricePoint[], region: string, now: number): RegionDay {
  const prices = points
    .filter((point) => point.region === region && point.actual && point.at > now - 24 * 3_600_000)
    .map((point) => point.price);
  if (prices.length === 0) return { average: null, low: null, high: null, negativeShare: null };
  return {
    average: prices.reduce((total, price) => total + price, 0) / prices.length,
    low: Math.min(...prices),
    high: Math.max(...prices),
    negativeShare: prices.filter((price) => price <= 0).length / prices.length,
  };
}
