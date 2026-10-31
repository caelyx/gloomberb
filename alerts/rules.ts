import { asxCodeFromSymbol } from "../shared/asx";

/**
 * AULRT rules: what to watch for (an announcement type or a coming dividend
 * date) and whose (one company, every ASX holding in a portfolio or watchlist,
 * or the whole market). Stored in the plugin's config state as plain objects.
 */

export type AlertEvent = "results" | "dividend" | "halt" | "any" | "dividend-dates";
export type AlertScope = "ticker" | "watched" | "market";
export type DividendDateKind = "ex" | "record" | "pay";

export interface AuAlertRule {
  id: string;
  event: AlertEvent;
  scope: AlertScope;
  /** The ASX code when `scope` is `ticker`. */
  code: string | null;
  /** Announcement events only. */
  priceSensitiveOnly: boolean;
  /** Lower-case words the headline must contain. Announcement events only. */
  keyword: string | null;
  /** Dividend dates only. */
  dates: DividendDateKind[];
  /** Dividend dates only: alert this many days before the date (0 = on the day). */
  leadDays: number;
  /** Nothing released before this fires; reset when a paused rule resumes. */
  createdAt: number;
  status: "active" | "paused";
}

export const MAX_RULES = 50;
export const MAX_LEAD_DAYS = 14;

export const EVENT_LABELS: Record<AlertEvent, string> = {
  results: "Results and earnings",
  dividend: "Dividend announcements",
  "dividend-dates": "Dividend dates",
  halt: "Trading halts",
  any: "Any announcement",
};

export const SCOPE_LABELS: Record<AlertScope, string> = {
  ticker: "One company",
  watched: "Portfolios and watchlists",
  market: "Whole market",
};

export const DATE_OPTIONS: Record<string, DividendDateKind[]> = {
  ex: ["ex"],
  "ex,pay": ["ex", "pay"],
  pay: ["pay"],
  all: ["ex", "record", "pay"],
};

const EVENTS = Object.keys(EVENT_LABELS) as AlertEvent[];
const SCOPES = Object.keys(SCOPE_LABELS) as AlertScope[];
const DATE_KINDS: readonly DividendDateKind[] = ["ex", "record", "pay"];

export const isAnnouncementRule = (rule: AuAlertRule): boolean => rule.event !== "dividend-dates";

function normalizeKeyword(raw: string | undefined): string | null {
  const keyword = (raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!keyword) return null;
  if (keyword.length > 80 || /[\u0000-\u001f]/.test(keyword)) throw new Error("Keep the keyword to 80 characters or fewer.");
  return keyword;
}

function sameRule(a: AuAlertRule, b: AuAlertRule): boolean {
  return a.event === b.event && a.scope === b.scope && a.code === b.code && a.priceSensitiveOnly === b.priceSensitiveOnly
    && a.keyword === b.keyword && a.dates.join() === b.dates.join() && a.leadDays === b.leadDays;
}

/** A rule from the Add ASX Alert form's values. Throws a message the form shows. */
export function createRule(values: Record<string, string | undefined>, existing: readonly AuAlertRule[], now = Date.now()): AuAlertRule {
  const event = values.event as AlertEvent;
  if (!EVENTS.includes(event)) throw new Error("Choose an event to watch for.");
  const scope = values.scope as AlertScope;
  if (!SCOPES.includes(scope)) throw new Error("Choose whom to watch: one company, your holdings or the whole market.");
  if (existing.length >= MAX_RULES) throw new Error(`Keep at most ${MAX_RULES} ASX alerts.`);

  let code: string | null = null;
  if (scope === "ticker") {
    const typed = (values.code ?? "").trim().toUpperCase();
    code = asxCodeFromSymbol(typed) ?? asxCodeFromSymbol(typed, "ASX");
    if (!code) throw new Error("Enter an ASX code, such as BHP or CBA.AX.");
  }

  const dividendDates = event === "dividend-dates";
  if (dividendDates && scope === "market") {
    throw new Error("Dividend dates are looked up company by company, so they cannot follow the whole market. Choose a company or your holdings.");
  }
  const priceSensitiveOnly = !dividendDates && values.priceSensitive === "yes";
  const keyword = dividendDates ? null : normalizeKeyword(values.keyword);
  // Trading halts and their lifts run to about ten a day across the market; these run to hundreds
  // (quarterly reports and fund distributions in season) and would bury every other alert.
  if (scope === "market" && !priceSensitiveOnly && !keyword && (event === "any" || event === "results" || event === "dividend")) {
    const what = event === "any" ? "Every announcement" : event === "results" ? "Every results announcement" : "Every dividend announcement";
    throw new Error(`${what} on the whole market is too broad (hundreds a day in reporting season). Limit it to price-sensitive ones or add a keyword.`);
  }

  let dates: DividendDateKind[] = [];
  let leadDays = 0;
  if (dividendDates) {
    dates = DATE_OPTIONS[values.dates || "ex"] ?? [];
    if (dates.length === 0) throw new Error("Choose which dividend dates to watch.");
    const lead = Number(values.leadDays?.trim() || "1");
    if (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS) throw new Error(`Days ahead must be a whole number from 0 to ${MAX_LEAD_DAYS}.`);
    leadDays = lead;
  }

  const rule: AuAlertRule = {
    id: crypto.randomUUID(),
    event, scope, code, priceSensitiveOnly, keyword, dates, leadDays,
    createdAt: now,
    status: "active",
  };
  if (existing.some((other) => sameRule(other, rule))) throw new Error("This ASX alert already exists.");
  return rule;
}

function readRule(value: unknown): AuAlertRule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!EVENTS.includes(raw.event as AlertEvent) || !SCOPES.includes(raw.scope as AlertScope)) return null;
  if (raw.status !== "active" && raw.status !== "paused") return null;
  if (typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt) || raw.createdAt <= 0) return null;
  const code = raw.scope === "ticker" && typeof raw.code === "string" ? asxCodeFromSymbol(raw.code, "ASX") : null;
  if (raw.scope === "ticker" && !code) return null;
  const dates = Array.isArray(raw.dates) ? raw.dates.filter((kind): kind is DividendDateKind => DATE_KINDS.includes(kind)) : [];
  const leadDays = typeof raw.leadDays === "number" && Number.isInteger(raw.leadDays) && raw.leadDays >= 0 && raw.leadDays <= MAX_LEAD_DAYS ? raw.leadDays : 0;
  if (raw.event === "dividend-dates" && (dates.length === 0 || raw.scope === "market")) return null;
  return {
    id: raw.id,
    event: raw.event as AlertEvent,
    scope: raw.scope as AlertScope,
    code,
    priceSensitiveOnly: raw.priceSensitiveOnly === true,
    keyword: typeof raw.keyword === "string" && raw.keyword ? raw.keyword : null,
    dates,
    leadDays,
    createdAt: raw.createdAt,
    status: raw.status,
  };
}

/**
 * The saved rules. An unreadable entry is dropped on its own, so one bad rule
 * never hides the rest (Gloomberb's own event alerts drop the whole list).
 */
export function readRules(stored: unknown): AuAlertRule[] {
  if (!Array.isArray(stored)) return [];
  const ids = new Set<string>();
  const rules: AuAlertRule[] = [];
  for (const value of stored) {
    const rule = readRule(value);
    if (!rule || ids.has(rule.id)) continue;
    ids.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

/** Pause, or resume from now: nothing released while paused fires on resuming. */
export function toggleRule(rule: AuAlertRule, now = Date.now()): AuAlertRule {
  return rule.status === "active" ? { ...rule, status: "paused" } : { ...rule, status: "active", createdAt: now };
}

const EVENT_SHORT: Record<AlertEvent, string> = {
  results: "Results",
  dividend: "Dividends",
  "dividend-dates": "Dividend dates",
  halt: "Trading halts",
  any: "Any announcement",
};

/** The rule in words, for the Rules view: `Trading halts · BHP`. */
export function describeRule(rule: AuAlertRule): string {
  const parts = [EVENT_SHORT[rule.event], rule.scope === "ticker" ? rule.code ?? "" : rule.scope === "watched" ? "portfolios and watchlists" : "whole market"];
  if (rule.priceSensitiveOnly) parts.push("price-sensitive");
  if (rule.keyword) parts.push(`"${rule.keyword}"`);
  if (rule.event === "dividend-dates") {
    parts.push(rule.dates.join(", "));
    parts.push(rule.leadDays === 0 ? "on the day" : `${rule.leadDays} day${rule.leadDays === 1 ? "" : "s"} ahead`);
  }
  return parts.join(" · ");
}
