// Published full-day closures (weekend dates omitted) for Asia-Pacific venues,
// not a holiday-rule engine. A year a venue has not published is unknown, not
// open: every weekday of it reads as a session. Of the half-day sessions, only
// ASX's early closes are listed; HKEX and SGX eves are not. Checked 2026-10-09:
// KRX, also KOSDAQ: http://open.krx.co.kr/contents/MKD/01/0110/01100305/MKD01100305.jsp
// TWSE, whose closures TPEx shares: https://www.twse.com.tw/en/trading/holiday.html
//   (2027 not yet published; 12 and 13 Feb 2026 are clearing-only days without trading)
// HKEX: https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf
//   and https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2026/ce_SEHK_CT_077_2026.pdf
// SGX closes on Singapore's gazetted public holidays, one on a Sunday moving to the Monday:
//   https://www.sgx.com/stock-exchange/trading and https://www.mom.gov.sg/employment-practices/public-holidays
// ASX: https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar
//   (2026 and 2027; 2024 and 2025 are the weekdays missing from ASX daily bars, checked 2026-10-08).
//   ASX stays open on substitute public holidays it does not list, such as Monday 26 April 2027.
const KRX_CLOSURES: Record<number, readonly string[]> = {
  2026: [
    "01-01", "02-16", "02-17", "02-18", "03-02", "05-01", "05-05", "05-25", "06-03",
    "07-17", "08-17", "09-24", "09-25", "10-05", "10-09", "12-25", "12-31",
  ],
  2027: [
    "01-01", "02-08", "02-09", "03-01", "05-03", "05-05", "05-13", "07-19", "08-16",
    "09-14", "09-15", "09-16", "10-04", "10-11", "12-27", "12-31",
  ],
};

const TWSE_CLOSURES: Record<number, readonly string[]> = {
  2026: [
    "01-01", "02-12", "02-13", "02-16", "02-17", "02-18", "02-19", "02-20", "02-27",
    "04-03", "04-06", "05-01", "06-19", "09-25", "09-28", "10-09", "10-26", "12-25",
  ],
};

/** Closures by canonical venue code. */
export const PUBLISHED_APAC_CLOSURES: Readonly<Record<string, Record<number, readonly string[]>>> = {
  KRX: KRX_CLOSURES,
  KOSDAQ: KRX_CLOSURES,
  TWSE: TWSE_CLOSURES,
  TPEX: TWSE_CLOSURES,
  HKEX: {
    2026: [
      "01-01", "02-17", "02-18", "02-19", "04-03", "04-06", "04-07", "05-01", "05-25",
      "06-19", "07-01", "10-01", "10-19", "12-25",
    ],
    2027: [
      "01-01", "02-08", "02-09", "03-26", "03-29", "04-05", "05-13", "06-09", "07-01",
      "09-16", "10-01", "10-08", "12-27",
    ],
  },
  SGX: {
    2026: ["01-01", "02-17", "02-18", "04-03", "05-01", "05-27", "06-01", "08-10", "11-09", "12-25"],
    2027: ["01-01", "02-08", "03-10", "03-26", "05-17", "05-20", "08-09", "10-28"],
  },
  ASX: {
    2024: ["01-01", "01-26", "03-29", "04-01", "04-25", "06-10", "12-25", "12-26"],
    2025: ["01-01", "01-27", "04-18", "04-21", "04-25", "06-09", "12-25", "12-26"],
    2026: ["01-01", "01-26", "04-03", "04-06", "06-08", "12-25", "12-28"],
    2027: ["01-01", "01-26", "03-26", "03-29", "06-14", "12-27", "12-28"],
  },
};

/**
 * Published early closes by canonical venue code. ASX's closing auction runs
 * at 14:10 Sydney time on the last trading days before Christmas and before
 * New Year, instead of 16:10.
 */
const PUBLISHED_APAC_EARLY_CLOSES: Readonly<Record<string, ReadonlySet<string>>> = {
  ASX: new Set([
    "2024-12-24", "2024-12-31", "2025-12-24", "2025-12-31",
    "2026-12-24", "2026-12-31", "2027-12-24", "2027-12-31",
  ]),
};

/** True only for a published full-day closure; unpublished years are unknown, not open. */
export function isPublishedApacClosure(exchange: string, date: string): boolean {
  if (!Object.hasOwn(PUBLISHED_APAC_CLOSURES, exchange)) return false;
  return PUBLISHED_APAC_CLOSURES[exchange]![Number(date.slice(0, 4))]?.includes(date.slice(5)) ?? false;
}

/** True when the venue's closures of that year are published. */
export function hasPublishedApacCalendar(exchange: string, year: number): boolean {
  return Object.hasOwn(PUBLISHED_APAC_CLOSURES, exchange) && PUBLISHED_APAC_CLOSURES[exchange]![year] !== undefined;
}

/** True on a published early close; the session still trades. */
export function isPublishedApacEarlyClose(exchange: string, date: string): boolean {
  return Object.hasOwn(PUBLISHED_APAC_EARLY_CLOSES, exchange) && PUBLISHED_APAC_EARLY_CLOSES[exchange]!.has(date);
}
