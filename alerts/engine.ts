import type { AsxAnnouncement } from "../announcements/model";
import type { FrankingSnapshot } from "../franking/model";
import { formatDay, formatReleased, sydneyToday } from "../shared/time";
import { dueDividendDates, dueLabel } from "./dividend-dates";
import { alertLabels, announcementLabel, matchAnnouncement } from "./match";
import { isAnnouncementRule, type AuAlertRule } from "./rules";

/**
 * One AULRT check: read the market announcement feed back to the last check,
 * match it against the rules, and look up the coming dividend dates the rules
 * follow. Pure apart from the injected loaders, so it is tested without the
 * network; the service (service.ts) supplies them and keeps the state.
 */

const MINUTE = 60_000;
/**
 * Each check re-reads this far behind the newest item already seen, and skips
 * what it has seen by id, so an item whose release time is earlier than when it
 * reached the feed is still caught.
 */
export const OVERLAP_MS = 30 * MINUTE;
/** The first check after a rule is made never reaches back more than a day. */
const FIRST_LOOKBACK_MS = 24 * 60 * MINUTE;
/** 500 a page: 4,000 items, roughly a quiet week or two busy reporting-season days. */
export const DEFAULT_MAX_PAGES = 8;
const MAX_FIRED_KEYS = 1000;
const DIVIDEND_CONCURRENCY = 3;

export interface FeedCursor {
  /** Release time of the newest item read. */
  latest: number;
  /** Ids of items read within OVERLAP_MS of `latest`. */
  seen: string[];
}

export interface AlertState {
  /** Null until a check reads the feed for an active announcement rule. */
  cursor: FeedCursor | null;
  /** Dividend dates already alerted, `ruleId:code:kind:date`. */
  firedKeys: string[];
  lastCheckAt: number | null;
}

export const EMPTY_STATE: AlertState = { cursor: null, firedKeys: [], lastCheckAt: null };

export interface FiredAlert {
  id: string;
  kind: "announcement" | "dividend-date";
  code: string;
  /** `Trading halt`, `Results date`, `Ex-dividend tomorrow`. */
  label: string;
  /** The announcement's headline, or the dividend's amount and date. */
  headline: string;
  /** Release time, or the dividend date (UTC midnight). */
  at: number;
  firedAt: number;
  priceSensitive: boolean;
  documentUrl: string | null;
  ruleIds: string[];
  /** From the ASX directory, when it has the code; added by the service. */
  companyName?: string;
}

export interface CheckDeps {
  now: number;
  rules: readonly AuAlertRule[];
  state: AlertState;
  /** One page of the market feed, newest first. */
  fetchPage(page: number): Promise<AsxAnnouncement[]>;
  /** `refresh`: this check's feed carried a dividend announcement for the company, so a cached copy may be out of date. */
  loadDividend(code: string, refresh: boolean): Promise<FrankingSnapshot>;
  /** ASX codes held in any portfolio or watchlist. */
  watchedCodes(): Promise<Set<string>>;
  maxPages?: number;
}

export interface CheckResult {
  fired: FiredAlert[];
  state: AlertState;
  /** False when the page limit stopped the feed before the last check. */
  complete: boolean;
  pages: number;
  notes: string[];
  errors: string[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface ScanResult {
  fresh: AsxAnnouncement[];
  cursor: FeedCursor;
  complete: boolean;
  pages: number;
}

/** The items released since the cursor (or `baseline` on a first read), reading as few pages as reach it. */
async function scanFeed(fetchPage: CheckDeps["fetchPage"], cursor: FeedCursor | null, baseline: number, maxPages: number, now: number): Promise<ScanResult> {
  const floor = cursor ? cursor.latest - OVERLAP_MS : baseline;
  const seen = new Set(cursor?.seen ?? []);
  const read = new Map<string, AsxAnnouncement>();
  let complete = false;
  let pages = 0;
  for (let page = 0; page < maxPages; page++) {
    const items = await fetchPage(page);
    pages += 1;
    // Items arriving while paging shift the pages, so one can come round twice.
    for (const item of items) if (!read.has(item.id)) read.set(item.id, item);
    if (items.length === 0 || items.some((item) => item.releasedAt < floor)) {
      complete = true;
      break;
    }
  }
  const all = [...read.values()];
  // Never past the clock: one item stamped in the future would otherwise move
  // the floor past every real item released before that time.
  const latest = Math.min(now, Math.max(cursor?.latest ?? baseline, ...all.map((item) => item.releasedAt)));
  return {
    fresh: all.filter((item) => item.releasedAt >= floor && !seen.has(item.id)),
    cursor: { latest, seen: all.filter((item) => item.releasedAt >= latest - OVERLAP_MS).map((item) => item.id) },
    complete,
    pages,
  };
}

function dividendHeadline(snapshot: FrankingSnapshot, kind: string, date: string): string {
  const parts: string[] = [];
  const name = snapshot.kind === "other" ? "Dividend" : `${snapshot.kind[0]!.toUpperCase()}${snapshot.kind.slice(1)} dividend`;
  const amount = snapshot.amount != null ? ` A$${Number(snapshot.amount.toFixed(4))}` : "";
  parts.push(`${name}${amount}${snapshot.frankingPercent != null ? `, ${Number(snapshot.frankingPercent.toFixed(1))}% franked` : ""}`);
  parts.push(`${kind} ${formatDay(date)}`);
  return parts.join(" · ");
}

async function mapLimited<T, R>(values: readonly T[], limit: number, run: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await run(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const DATE_WORDS = { ex: "ex", record: "record", pay: "paid" } as const;

export async function runCheck(deps: CheckDeps): Promise<CheckResult> {
  const { now } = deps;
  const active = deps.rules.filter((rule) => rule.status === "active");
  const announcementRules = active.filter(isAnnouncementRule);
  const dividendRules = active.filter((rule) => !isAnnouncementRule(rule));
  const notes: string[] = [];
  const errors: string[] = [];
  const fired: FiredAlert[] = [];

  let watched: Set<string> = new Set();
  if (active.some((rule) => rule.scope === "watched")) {
    try {
      watched = await deps.watchedCodes();
    } catch (error) {
      errors.push(`Portfolios and watchlists: ${message(error)}`);
    }
  }

  // Announcements. With no rule to serve the cursor is dropped, so a rule made
  // later starts from its own creation rather than catching up on weeks of feed.
  let cursor: FeedCursor | null = null;
  const dividendAnnounced = new Set<string>();
  let complete = true;
  let pages = 0;
  if (announcementRules.length > 0) {
    cursor = deps.state.cursor;
    const baseline = Math.max(now - FIRST_LOOKBACK_MS, Math.min(...announcementRules.map((rule) => rule.createdAt)));
    try {
      const scan = await scanFeed(deps.fetchPage, deps.state.cursor, baseline, deps.maxPages ?? DEFAULT_MAX_PAGES, now);
      pages = scan.pages;
      complete = scan.complete;
      if (!scan.complete) {
        const from = deps.state.cursor ? deps.state.cursor.latest : baseline;
        notes.push(`More announcements arrived since ${formatReleased(from, now)} (Sydney) than one check reads; the oldest of them were not checked.`);
      }
      cursor = scan.cursor;
      for (const item of scan.fresh.sort((a, b) => b.releasedAt - a.releasedAt)) {
        const labels = alertLabels(item);
        if (labels.dividend) dividendAnnounced.add(item.code);
        const ruleIds = announcementRules.filter((rule) => matchAnnouncement(rule, item, watched, labels)).map((rule) => rule.id);
        if (ruleIds.length === 0) continue;
        fired.push({
          id: item.id, kind: "announcement", code: item.code, label: announcementLabel(item, labels), headline: item.headline,
          at: item.releasedAt, firedAt: now, priceSensitive: item.priceSensitive, documentUrl: item.documentUrl, ruleIds,
        });
      }
    } catch (error) {
      errors.push(`ASX announcements: ${message(error)}`);
    }
  }

  // Dividend dates, from each company's latest declared dividend.
  const firedKeys = new Set(deps.state.firedKeys);
  if (dividendRules.length > 0) {
    const codesFor = (rule: AuAlertRule) => (rule.scope === "ticker" && rule.code ? [rule.code] : [...watched]);
    const codes = [...new Set(dividendRules.flatMap(codesFor))].sort();
    const snapshots = new Map<string, FrankingSnapshot>();
    await mapLimited(codes, DIVIDEND_CONCURRENCY, async (code) => {
      try {
        snapshots.set(code, await deps.loadDividend(code, dividendAnnounced.has(code)));
      } catch (error) {
        errors.push(`Dividend dates for ${code}: ${message(error)}`);
      }
    });
    const today = sydneyToday(now);
    const byEvent = new Map<string, FiredAlert>();
    for (const rule of dividendRules) {
      for (const code of codesFor(rule)) {
        const snapshot = snapshots.get(code);
        if (!snapshot) continue;
        for (const due of dueDividendDates(rule, snapshot, today)) {
          const key = `${rule.id}:${code}:${due.kind}:${due.date}`;
          if (firedKeys.has(key)) continue;
          firedKeys.add(key);
          const eventId = `div:${code}:${due.kind}:${due.date}:${due.daysAway}`;
          const existing = byEvent.get(eventId);
          if (existing) {
            existing.ruleIds.push(rule.id);
            continue;
          }
          const alert: FiredAlert = {
            id: eventId, kind: "dividend-date", code, label: dueLabel(due), headline: dividendHeadline(snapshot, DATE_WORDS[due.kind], due.date),
            at: Date.parse(`${due.date}T00:00:00Z`), firedAt: now, priceSensitive: false, documentUrl: null, ruleIds: [rule.id],
          };
          byEvent.set(eventId, alert);
          fired.push(alert);
        }
      }
    }
  }

  return {
    fired,
    state: { cursor, firedKeys: [...firedKeys].slice(-MAX_FIRED_KEYS), lastCheckAt: now },
    complete,
    pages,
    notes,
    errors,
  };
}
