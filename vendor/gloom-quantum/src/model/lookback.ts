// The lookback window (brief §5): [today − N years, today] on date_primary,
// applied to hardware results only, never to estimates or boundaries.

export const LOOKBACK_VALUES = ["1", "2", "5", "all"] as const;
export type LookbackYears = (typeof LOOKBACK_VALUES)[number];

export function parseLookback(value: unknown, fallback: LookbackYears): LookbackYears {
  return (LOOKBACK_VALUES as readonly unknown[]).includes(value) ? (value as LookbackYears) : fallback;
}

/** Today as `YYYY-MM-DD` in local time (Sydney is ahead of UTC for most of the day). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A dataset version (`2026.10.10`) as the `YYYY-MM-DD` date it was curated on. */
export function versionDate(datasetVersion: string): string {
  return datasetVersion.replaceAll(".", "-");
}

/**
 * The day a window ends on: the local day, but never before the dataset
 * version's date. The curator dates rows with the Sydney date, so a reader
 * west of Sydney would otherwise lose the newest rows until their midnight.
 */
export function effectiveToday(datasetVersion: string, local: string = localToday()): string {
  const version = versionDate(datasetVersion);
  return version > local ? version : local;
}

/** First day inside the window, or null for `all`. */
export function lookbackStart(today: string, years: LookbackYears): string | null {
  if (years === "all") return null;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const year = y - Number(years);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `all` keeps every row, whatever its date; a bounded window ends on `today`. */
export function inLookback(date: string, years: LookbackYears, today: string): boolean {
  if (years === "all") return true;
  if (date > today) return false;
  const start = lookbackStart(today, years);
  return start === null || date >= start;
}
