import type { FrankingSnapshot } from "../franking/model";
import type { AuAlertRule, DividendDateKind } from "./rules";

export interface DueDividendDate {
  kind: DividendDateKind;
  /** ISO date, as ASX gives it. */
  date: string;
  /** Whole days from today (Sydney) to the date. */
  daysAway: number;
}

const FIELD: Record<DividendDateKind, keyof Pick<FrankingSnapshot, "exDate" | "recordDate" | "payDate">> = {
  ex: "exDate",
  record: "recordDate",
  pay: "payDate",
};

function dayNumber(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/**
 * The rule's dividend dates that fall from today to `leadDays` ahead, for the
 * company's latest declared dividend. `today` is the Sydney calendar date.
 */
export function dueDividendDates(rule: AuAlertRule, snapshot: FrankingSnapshot, today: string): DueDividendDate[] {
  const todayNumber = dayNumber(today);
  if (todayNumber == null) return [];
  const due: DueDividendDate[] = [];
  for (const kind of rule.dates) {
    const date = snapshot[FIELD[kind]];
    const target = date ? dayNumber(date) : null;
    if (!date || target == null) continue;
    const daysAway = target - todayNumber;
    if (daysAway >= 0 && daysAway <= rule.leadDays) due.push({ kind, date, daysAway });
  }
  return due;
}

const NAMES: Record<DividendDateKind, string> = { ex: "Ex-dividend", record: "Record date", pay: "Dividend paid" };

/** `Ex-dividend tomorrow`, `Dividend paid today`, `Record date in 3 days`. */
export function dueLabel(due: DueDividendDate): string {
  const when = due.daysAway === 0 ? "today" : due.daysAway === 1 ? "tomorrow" : `in ${due.daysAway} days`;
  return `${NAMES[due.kind]} ${when}`;
}
