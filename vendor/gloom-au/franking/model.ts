/**
 * Franking credits: Australian dividends carry the company tax already paid on
 * the profits behind them. A shareholder adds the credit to taxable income and
 * offsets it against tax, so a fully franked dividend is worth more than its
 * cash amount to most Australian residents.
 */

/** The general company tax rate. Base-rate entities pay 25%; ASX's data does not say which applies. */
export const COMPANY_TAX_RATE = 0.3;

export type DividendKind = "final" | "interim" | "special" | "other";

export interface FrankingSnapshot {
  code: string;
  /** Cash per share in AUD, as ASX converts a foreign-currency dividend. */
  amount: number | null;
  /** The currency the company declared in, e.g. USD for BHP. */
  declaredCurrency: string | null;
  /** The declared amount when it was not AUD. */
  declaredAmount: number | null;
  kind: DividendKind;
  /** 0 to 100. */
  frankingPercent: number | null;
  exDate: string | null;
  recordDate: string | null;
  payDate: string | null;
  /** ASX's annual cash yield, as a fraction. */
  annualYield: number | null;
}

/** The credit attached to a cash dividend at a franking percentage. */
export function frankingCredit(amount: number, frankingPercent: number, taxRate = COMPANY_TAX_RATE): number {
  const franked = Math.max(0, Math.min(100, frankingPercent)) / 100;
  return amount * franked * taxRate / (1 - taxRate);
}

/** Cash plus credit: 1 + f·t/(1−t) times the cash amount, 1.4286× when fully franked at 30%. */
export function grossUpFactor(frankingPercent: number, taxRate = COMPANY_TAX_RATE): number {
  return 1 + frankingCredit(1, frankingPercent, taxRate);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

const KINDS: Record<string, DividendKind> = { F: "final", I: "interim", S: "special" };

/**
 * `companies/{code}/key-statistics`. `dividend` is the AUD amount; when the
 * company declared in another currency, `dividendCurrency` names it and
 * `foreignCurrencyAmount` holds the declared amount (BHP: US$0.99 shown as
 * A$1.3799).
 */
export function parseKeyStatistics(payload: unknown, code: string): FrankingSnapshot {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") throw new Error("ASX key statistics format was not recognised");
  const amount = finiteNumber(data.dividend);
  const currency = typeof data.dividendCurrency === "string" ? data.dividendCurrency.trim().toUpperCase() || null : null;
  const foreign = finiteNumber(data.foreignCurrencyAmount);
  const franking = finiteNumber(data.frankingPercent);
  const annualYield = finiteNumber(data.yieldAnnual);
  return {
    code,
    amount: amount != null && amount > 0 ? amount : null,
    declaredCurrency: currency,
    declaredAmount: currency && currency !== "AUD" && foreign != null && foreign > 0 ? foreign : null,
    kind: KINDS[typeof data.dividendType === "string" ? data.dividendType.trim().toUpperCase() : ""] ?? "other",
    frankingPercent: franking != null && franking >= 0 && franking <= 100 ? franking : null,
    exDate: isoDate(data.dateExDate),
    recordDate: isoDate(data.dateRecordDate),
    payDate: isoDate(data.datePayDate),
    annualYield: annualYield != null && annualYield >= 0 ? annualYield / 100 : null,
  };
}

/**
 * A cash yield grossed up at the latest dividend's franking. It assumes the
 * year's other dividends were franked alike, which holds for most companies.
 */
export function grossedUpYield(cashYield: number | null | undefined, frankingPercent: number | null | undefined): number | null {
  if (cashYield == null || !Number.isFinite(cashYield) || frankingPercent == null) return null;
  return cashYield * grossUpFactor(frankingPercent);
}
