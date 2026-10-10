import { zonedDateTimeParts } from "gloomberb/utils";
import { ASX_TIME_ZONE } from "./asx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Sydney calendar date of an instant (default now), as an ISO date. */
export function sydneyToday(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ASX_TIME_ZONE }).format(new Date(now));
}

/** The calendar year in Sydney (the UTC year lags it for a few hours each New Year). */
export function sydneyYear(now = Date.now()): number {
  return zonedDateTimeParts(now, ASX_TIME_ZONE).year;
}

/** `08 Oct 09:23` this year, `08 Oct 2025` before it; Sydney time. */
export function formatReleased(ms: number, now = Date.now()): string {
  const at = zonedDateTimeParts(ms, ASX_TIME_ZONE);
  const today = zonedDateTimeParts(now, ASX_TIME_ZONE);
  const day = `${String(at.day).padStart(2, "0")} ${MONTHS[at.month - 1]}`;
  return at.year === today.year
    ? `${day} ${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`
    : `${day} ${at.year}`;
}

/** `2026-10-05` as `05 Oct 2026`: the day-only form of `formatReleased`. Anything else is returned as is. */
export function formatDay(iso: string | null | undefined, fallback = "—"): string {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso || fallback;
  return `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}
