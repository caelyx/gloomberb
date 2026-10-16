import { canonicalExchange } from "../utils/exchanges";
import { isTradingWeekday } from "./market/freshness";
import { isPublishedApacClosure, PUBLISHED_APAC_CLOSURES } from "./published-apac-sessions";
import { isPublishedCnClosure, publishedYearsCn } from "./published-cn-sessions";
import { isPublishedJpxClosure, publishedYearsJpx } from "./published-jpx-sessions";
import { isPublishedNseClosure, publishedYearsNse } from "./published-nse-sessions";
import { getPublishedUsEquityCalendarDay, getPublishedUsEquityCalendarYears } from "./published-us-sessions";

interface PublishedClosures {
  years: readonly number[];
  isClosure(date: string): boolean;
}

// Weekly closes and the weekend rule below assume a Monday-to-Friday week, so a
// venue that trades Sunday to Thursday (BHB, MSX, EGX) has no calendar here.
const isMondayToFriday = (venue: string) => [0, 1, 2, 3, 4, 5, 6].every((day) => isTradingWeekday(venue, day) === (day >= 1 && day <= 5));

const NON_US_CALENDARS = new Map<string, PublishedClosures>([
  ["JPX", { years: publishedYearsJpx(), isClosure: isPublishedJpxClosure }],
  ["NSE", { years: publishedYearsNse(), isClosure: isPublishedNseClosure }],
  ["BSE", { years: publishedYearsNse(), isClosure: isPublishedNseClosure }],
  ["SSE", { years: publishedYearsCn(), isClosure: isPublishedCnClosure }],
  ["SZSE", { years: publishedYearsCn(), isClosure: isPublishedCnClosure }],
  ...Object.entries(PUBLISHED_APAC_CLOSURES).filter(([venue]) => isMondayToFriday(venue)).map(([venue, closures]): [string, PublishedClosures] => [venue, {
    years: Object.keys(closures).map(Number),
    isClosure: (date) => isPublishedApacClosure(venue, date),
  }]),
]);

/** Years with published full-day closures for a venue, or null when it has no published calendar. */
export function getPublishedCalendarYears(exchange: string): readonly number[] | null {
  const venue = canonicalExchange(exchange);
  return NON_US_CALENDARS.get(venue)?.years ?? getPublishedUsEquityCalendarYears(venue);
}

/**
 * Whether a date is a session on the venue's published calendar: weekends and
 * published closures are closed. Null outside published coverage, which is
 * unknown rather than open. Says nothing about session hours.
 */
export function getPublishedCalendarDay(exchange: string, date: string): "session" | "closed" | null {
  const venue = canonicalExchange(exchange);
  const calendar = NON_US_CALENDARS.get(venue);
  if (!calendar) return getPublishedUsEquityCalendarDay(venue, date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return null;
  if (!calendar.years.includes(new Date(time).getUTCFullYear())) return null;
  const weekday = new Date(time).getUTCDay();
  return weekday === 0 || weekday === 6 || calendar.isClosure(date) ? "closed" : "session";
}
