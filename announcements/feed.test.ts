import { describe, expect, test } from "bun:test";
import page0 from "./fixtures/announcements-cba-page0.json";
import predictive from "./fixtures/predictive-cba.json";
import { entityFeedUrl, parseFeedPage, pickEntity } from "./feed";

// Real captures from 29 Sep 2026 (CBA's ten newest; the two newest were lodged by CAR Group).
describe("pickEntity", () => {
  test("takes the exact symbol's entity, not the first similar company", () => {
    const payload = { data: { items: [{ xidEntity: 1, symbol: "CBAPM", displayName: "CBA PERLS" }, ...predictive.data.items] } };
    expect(pickEntity(payload, "cba")).toEqual({ xid: "204245597", symbol: "CBA", displayName: "COMMONWEALTH BANK OF AUSTRALIA." });
    expect(pickEntity(payload, "BHP")).toBeNull();
    expect(pickEntity(null, "CBA")).toBeNull();
  });
});

describe("parseFeedPage", () => {
  const page = parseFeedPage(page0, 0, 10);

  test("keeps every live item newest first, other issuers' notices under their own code and name", () => {
    expect(page.items).toHaveLength(10);
    expect(page.items[0]).toMatchObject({ code: "CAR", companyName: "CAR GROUP LIMITED", headline: "Ceasing to be a substantial holder from CBA" });
    const dividend = page.items.find((item) => item.headline === "Update - Dividend/Distribution - CBA")!;
    expect(dividend).toMatchObject({ code: "CBA", companyName: "COMMONWEALTH BANK OF AUSTRALIA.", priceSensitive: false, category: "dividend" });
    expect(dividend.documentUrl).toBe(`https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/${dividend.documentKey}`);
    expect(page.items.map((item) => item.releasedAt)).toEqual([...page.items.map((item) => item.releasedAt)].sort((a, b) => b - a));
  });

  test("the feed's count is the entity's total; an empty page ends paging whatever it says", () => {
    expect(page.totalItems).toBe(7773);
    expect(page.hasMore).toBe(true);
    expect(parseFeedPage(page0, 777, 10).hasMore).toBe(false);
    expect(parseFeedPage({ data: { items: [], count: 7773 } }, 5).hasMore).toBe(false);
    const short = { data: { items: page0.data.items.slice(0, 3) } };
    expect(parseFeedPage(short, 0, 3).hasMore).toBe(true);
    expect(parseFeedPage(short, 0, 50).hasMore).toBe(false);
  });

  test("the entity filter is sent with literal brackets, as asx.com.au sends it", () => {
    expect(entityFeedUrl("204245597", 2)).toContain("entityXids[]=204245597&page=2&itemsPerPage=50");
  });
});
