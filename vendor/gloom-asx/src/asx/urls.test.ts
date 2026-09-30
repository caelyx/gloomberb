import { describe, expect, test } from "bun:test";
import {
  ASX_API_HOST, ASX_CDN_HOST, ASX_WEB_HOST, PLUGIN_HOSTS,
  announcementsUrl, asxAnnouncementsPageUrl, pdfUrl, predictiveSearchUrl,
} from "./urls";

describe("urls", () => {
  test("hosts list covers every host the plugin fetches from, over https", () => {
    expect(PLUGIN_HOSTS).toEqual([ASX_API_HOST, ASX_CDN_HOST]);
    const fetched = [predictiveSearchUrl("CBA"), announcementsUrl({ xid: "1", page: 0, itemsPerPage: 50 }), pdfUrl("k"), pdfUrl("k", "tok")];
    for (const url of fetched.map((u) => new URL(u))) {
      expect(url.protocol).toBe("https:");
      expect(PLUGIN_HOSTS).toContain(url.hostname);
    }
  });

  test("the asx.com.au page is only opened in a browser, so the web proxy is not asked to allow it", () => {
    expect(new URL(asxAnnouncementsPageUrl("CBA")).hostname).toBe(ASX_WEB_HOST);
    expect(PLUGIN_HOSTS).not.toContain(ASX_WEB_HOST);
  });

  test("predictive search URL matches the form used by the ASX front end", () => {
    expect(predictiveSearchUrl("cba")).toBe(
      "https://asx.api.markitdigital.com/asx-research/1.0/search/predictive?searchText=CBA",
    );
  });

  test("announcements URL filters by entity xid with a literal [] key", () => {
    expect(announcementsUrl({ xid: "1234567", page: 2, itemsPerPage: 50 })).toBe(
      "https://asx.api.markitdigital.com/asx-research/1.0/markets/announcements?entityXids[]=1234567&page=2&itemsPerPage=50",
    );
  });

  test("announcements URL encodes unexpected characters in the xid", () => {
    expect(announcementsUrl({ xid: "a b&c", page: 0, itemsPerPage: 10 })).toContain("entityXids[]=a%20b%26c");
  });

  test("pdf URL is the Markit file gateway, with an optional access token", () => {
    expect(pdfUrl("2924-03118748-2A1688146")).toBe(
      "https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/2924-03118748-2A1688146",
    );
    expect(pdfUrl("2924-03118748-2A1688146", "tok")).toBe(
      "https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/2924-03118748-2A1688146?access_token=tok",
    );
  });

  test("ASX announcements web page for a code is lower-cased", () => {
    expect(asxAnnouncementsPageUrl("CBA")).toBe(
      "https://www.asx.com.au/markets/trade-our-cash-market/announcements.cba",
    );
  });
});
