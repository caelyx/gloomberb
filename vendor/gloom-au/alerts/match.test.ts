import { describe, expect, test } from "bun:test";
import { parseMarketAnnouncementsJson, type AsxAnnouncement } from "../announcements/model";
import market from "./fixtures/market-types.json";
import { alertLabels, matchAnnouncement } from "./match";
import { createRule } from "./rules";

const items = parseMarketAnnouncementsJson(market);
const byCode = (code: string) => {
  const item = items.find((entry) => entry.code === code);
  if (!item) throw new Error(`fixture has no ${code}`);
  return item;
};
const bare = (over: Partial<AsxAnnouncement>): AsxAnnouncement => ({
  id: "x", code: "XYZ", companyName: null, documentKey: null, releasedAt: Date.parse("2026-10-09T00:00:00Z"), headline: "",
  priceSensitive: false, category: "other", types: [], pages: null, size: null, documentUrl: null, ...over,
});

describe("alertLabels: ASX's own type labels decide the event", () => {
  test("trading halts, lifts, suspensions and reinstatements", () => {
    expect(alertLabels(byCode("NMR")).halt).toBe("Trading halt");
    expect(alertLabels(byCode("MGH")).halt).toBe("Halt lifted");
    expect(alertLabels(byCode("CBA")).halt).toBe("Suspended");
    expect(alertLabels(byCode("AAU")).halt).toBe("Reinstated");
  });

  test("dividends, including special ones; a warrant issuer's notice is not one", () => {
    expect(alertLabels(byCode("KIT")).dividend).toBe("Dividend");
    expect(alertLabels(byCode("KAT")).dividend).toBe("Special dividend");
    expect(alertLabels(byCode("CTW")).dividend).toBeUndefined();
  });

  test("results, quarterlies, guidance and notice of a results date", () => {
    expect(alertLabels(byCode("NTD")).results).toBe("Results");
    expect(alertLabels(byCode("ALK")).results).toBe("Quarterly");
    expect(alertLabels(byCode("AFP")).results).toBe("Guidance");
    expect(alertLabels(byCode("BOE")).results).toBe("Results date");
  });

  test("a meeting result or an exploration report is not earnings", () => {
    expect(alertLabels(byCode("SLB")).results).toBeUndefined();
    expect(alertLabels(byCode("ATM")).results).toBeUndefined();
  });

  test("without type labels, the headline decides, conservatively", () => {
    expect(alertLabels(bare({ headline: "Trading Halt", category: "halt" })).halt).toBe("Trading halt");
    expect(alertLabels(bare({ headline: "Appendix 4D and Half Year Report" })).results).toBe("Results");
    expect(alertLabels(bare({ headline: "Interim Dividend Declared" })).dividend).toBe("Dividend");
    expect(alertLabels(bare({ headline: "Top 20 Holders and Distribution Schedule" })).dividend).toBeUndefined();
    expect(alertLabels(bare({ headline: "Drilling results at Mt Weld" })).results).toBeUndefined();
  });
});

describe("matchAnnouncement", () => {
  const before = Date.parse("2026-10-01T00:00:00Z");
  const rule = (values: Record<string, string>) => createRule(values, [], before);
  const watched = new Set(["NMR", "KIT"]);

  test("scope: one company, holdings, or the whole market", () => {
    expect(matchAnnouncement(rule({ event: "halt", scope: "ticker", code: "NMR" }), byCode("NMR"), watched)).toBe(true);
    expect(matchAnnouncement(rule({ event: "halt", scope: "ticker", code: "BHP" }), byCode("NMR"), watched)).toBe(false);
    expect(matchAnnouncement(rule({ event: "halt", scope: "watched" }), byCode("NMR"), watched)).toBe(true);
    expect(matchAnnouncement(rule({ event: "halt", scope: "watched" }), byCode("MGH"), watched)).toBe(false);
    expect(matchAnnouncement(rule({ event: "halt", scope: "market" }), byCode("MGH"), watched)).toBe(true);
  });

  test("event: the rule's event must be among the announcement's", () => {
    expect(matchAnnouncement(rule({ event: "dividend", scope: "watched" }), byCode("NMR"), watched)).toBe(false);
    expect(matchAnnouncement(rule({ event: "dividend", scope: "watched" }), byCode("KIT"), watched)).toBe(true);
    expect(matchAnnouncement(rule({ event: "results", scope: "ticker", code: "BOE" }), byCode("BOE"), watched)).toBe(true);
    expect(matchAnnouncement(rule({ event: "any", scope: "watched" }), byCode("KIT"), watched)).toBe(true);
  });

  test("price-sensitive and keyword filters", () => {
    expect(matchAnnouncement(rule({ event: "dividend", scope: "watched", priceSensitive: "yes" }), byCode("KIT"), watched)).toBe(false);
    expect(matchAnnouncement(rule({ event: "dividend", scope: "market", priceSensitive: "yes" }), byCode("KAT"), watched)).toBe(true);
    expect(matchAnnouncement(rule({ event: "any", scope: "market", keyword: "special" }), byCode("KAT"), watched)).toBe(true);
    expect(matchAnnouncement(rule({ event: "any", scope: "market", keyword: "takeover" }), byCode("KAT"), watched)).toBe(false);
  });

  test("nothing released before the rule existed, and nothing while paused", () => {
    const late = createRule({ event: "halt", scope: "market" }, [], Date.parse("2026-10-09T03:00:00Z"));
    expect(matchAnnouncement(late, byCode("NMR"), watched)).toBe(false);
    expect(matchAnnouncement({ ...rule({ event: "halt", scope: "market" }), status: "paused" }, byCode("NMR"), watched)).toBe(false);
  });

  test("dividend date rules never match announcements", () => {
    expect(matchAnnouncement(rule({ event: "dividend-dates", scope: "watched" }), byCode("KIT"), watched)).toBe(false);
  });
});
