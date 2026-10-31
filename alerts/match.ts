import { CATEGORY_SHORT, type AsxAnnouncement } from "../announcements/model";
import type { AuAlertRule } from "./rules";

/**
 * Which alert events an announcement belongs to, with a short label for each.
 *
 * The market feed carries ASX's own type labels ("Trading Halt", "Dividend Pay
 * Date", "Full Year Accounts", "Notification of Results/Reporting Date"), set by
 * the lodging company under the listing rules, so they decide. ASXA's headline
 * categories are broader on purpose (any "results" headline, drilling results
 * included); for an earnings alert that would be noise. The headline is used
 * only when an item has no type labels, and then narrowly.
 */
export interface AlertLabels {
  results?: string;
  dividend?: string;
  halt?: string;
}

const HALT_TYPES: ReadonlyArray<[RegExp, string]> = [
  [/^trading halt$/i, "Trading halt"],
  [/^suspension from official quotation$/i, "Suspended"],
  [/^reinstatement to official quotation$/i, "Reinstated"],
  [/^trading halt lifted$/i, "Halt lifted"],
];

const RESULTS_TYPES: ReadonlyArray<[RegExp, string]> = [
  [/^(appendix 4[de]\b|annual report$|full year accounts$|half year(ly)? (accounts|report)|preliminary final report)/i, "Results"],
  [/quarter(ly)? (activit|cash ?flow)|^appendix 4c\b/i, "Quarterly"],
  [/^(profit guidance|trading update)$/i, "Guidance"],
  [/^notification of results\/reporting date$/i, "Results date"],
];

const HEADLINE_HALT: ReadonlyArray<[RegExp, string]> = [
  [/trading halt (lifted|ended)|end of trading halt/i, "Halt lifted"],
  [/reinstatement to (official )?quotation/i, "Reinstated"],
  [/suspension from (official )?quotation|voluntary suspension/i, "Suspended"],
  [/trading halt/i, "Trading halt"],
];

const HEADLINE_RESULTS: ReadonlyArray<[RegExp, string]> = [
  [/appendix 4[de]\b|half[- ]year(ly)? (report|results|accounts|financial)|full[- ]year (report|results|accounts|financial)|annual (financial )?report|preliminary final/i, "Results"],
  [/appendix 4c\b|quarterly (activit|cash ?flow)/i, "Quarterly"],
];

function firstLabel(values: readonly string[], rules: ReadonlyArray<[RegExp, string]>): string | undefined {
  for (const [pattern, label] of rules) {
    if (values.some((value) => pattern.test(value.trim()))) return label;
  }
  return undefined;
}

export function alertLabels(item: AsxAnnouncement): AlertLabels {
  const labels: AlertLabels = {};
  if (item.types.length > 0) {
    const halt = firstLabel(item.types, HALT_TYPES);
    if (halt) labels.halt = halt;
    const results = firstLabel(item.types, RESULTS_TYPES);
    if (results) labels.results = results;
    // "Dividend Rate", "Dividend Pay Date", "Dividend - Special", "Dividend Reinvestment Plan"...
    // Warrant issuers' "Structured Products Distribution" notices are left out.
    if (item.types.some((type) => /^dividend\b/i.test(type.trim()))) {
      labels.dividend = item.types.some((type) => /^dividend - special$/i.test(type.trim())) ? "Special dividend" : "Dividend";
    }
    return labels;
  }
  const halt = firstLabel([item.headline], HEADLINE_HALT);
  if (halt) labels.halt = halt;
  const results = firstLabel([item.headline], HEADLINE_RESULTS);
  if (results) labels.results = results;
  if (/\b(dividend|distribution)\b|\bdrp\b/i.test(item.headline) && !/top (20|twenty)\b|distribution schedule/i.test(item.headline)) {
    labels.dividend = /special/i.test(item.headline) ? "Special dividend" : "Dividend";
  }
  return labels;
}

/** The label an alert shows for an announcement: its alert event, else ASXA's category, else ASX's first type. */
export function announcementLabel(item: AsxAnnouncement, labels = alertLabels(item)): string {
  return labels.halt ?? labels.results ?? labels.dividend ?? (CATEGORY_SHORT[item.category] || item.types[0] || "Announcement");
}

/** Whether an announcement fires a rule. `watched` holds the ASX codes in portfolios and watchlists. */
export function matchAnnouncement(rule: AuAlertRule, item: AsxAnnouncement, watched: ReadonlySet<string>, labels = alertLabels(item)): boolean {
  if (rule.status !== "active" || rule.event === "dividend-dates") return false;
  if (item.releasedAt < rule.createdAt) return false;
  if (rule.scope === "ticker" && item.code !== rule.code) return false;
  if (rule.scope === "watched" && !watched.has(item.code)) return false;
  if (rule.priceSensitiveOnly && !item.priceSensitive) return false;
  if (rule.keyword && !item.headline.toLowerCase().replace(/\s+/g, " ").includes(rule.keyword)) return false;
  return rule.event === "any" || labels[rule.event] !== undefined;
}
