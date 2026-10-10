/** The eleven GICS sectors, in S&P's order. */
export const GICS_SECTORS = [
  "Energy",
  "Materials",
  "Industrials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Information Technology",
  "Communication Services",
  "Utilities",
  "Real Estate",
] as const;

export type GicsSector = (typeof GICS_SECTORS)[number];

/**
 * ASX publishes only the industry group. The names are those of the GICS
 * structure in force since March 2023, which is what the directory returns.
 */
const SECTOR_BY_INDUSTRY_GROUP: Readonly<Record<string, GicsSector>> = {
  "Energy": "Energy",
  "Materials": "Materials",
  "Capital Goods": "Industrials",
  "Commercial & Professional Services": "Industrials",
  "Transportation": "Industrials",
  "Automobiles & Components": "Consumer Discretionary",
  "Consumer Durables & Apparel": "Consumer Discretionary",
  "Consumer Services": "Consumer Discretionary",
  "Consumer Discretionary Distribution & Retail": "Consumer Discretionary",
  "Consumer Staples Distribution & Retail": "Consumer Staples",
  "Food, Beverage & Tobacco": "Consumer Staples",
  "Household & Personal Products": "Consumer Staples",
  "Health Care Equipment & Services": "Health Care",
  "Pharmaceuticals, Biotechnology & Life Sciences": "Health Care",
  "Banks": "Financials",
  "Financial Services": "Financials",
  "Insurance": "Financials",
  "Software & Services": "Information Technology",
  "Technology Hardware & Equipment": "Information Technology",
  "Semiconductors & Semiconductor Equipment": "Information Technology",
  "Telecommunication Services": "Communication Services",
  "Media & Entertainment": "Communication Services",
  "Utilities": "Utilities",
  "Equity Real Estate Investment Trusts (REITs)": "Real Estate",
  "Real Estate Management & Development": "Real Estate",
};

export function sectorForIndustryGroup(industryGroup: string | null | undefined): GicsSector | null {
  if (!industryGroup) return null;
  return SECTOR_BY_INDUSTRY_GROUP[industryGroup.trim()] ?? null;
}

export function isGicsSector(value: string): value is GicsSector {
  return (GICS_SECTORS as readonly string[]).includes(value);
}

/** Shorter names for headers and tiles too narrow for the full one; the short form still says which sector. */
const SHORT_SECTOR_NAMES: Readonly<Record<string, string>> = {
  "Consumer Discretionary": "Cons Disc",
  "Consumer Staples": "Cons Staples",
  "Communication Services": "Comm Svcs",
  "Information Technology": "Info Tech",
  "Real Estate": "Real Est",
};

export const shortSectorName = (name: string) => SHORT_SECTOR_NAMES[name] ?? name;

/** A sector's name, or its short form, in `width` columns; null when neither fits (it is never cut short). */
export function fitSectorName(name: string, width: number): string | null {
  if (name.length <= width) return name;
  const short = SHORT_SECTOR_NAMES[name];
  return short && short.length <= width ? short : null;
}
