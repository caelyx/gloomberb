import { expect, test } from "bun:test";
import { absHeadless } from "../abs/headless";
import { nemHeadless } from "../aemo/headless";
import { announcementsHeadless } from "../announcements/headless";
import { rbaHeadless } from "../rba/headless";
import { rbapHeadless } from "../rbap/headless";
import { shortsHeadless } from "../shorts/headless";
import { contractsHeadless } from "../tenders/headless";

// Without a source, `fn` footers fall back to the host's "Gloom Cloud", which these reports never use.
test("each report that reads a public source directly names it", () => {
  const sources = Object.fromEntries(Object.entries({
    RBA: rbaHeadless, RBAP: rbapHeadless, ABS: absHeadless, ASXA: announcementsHeadless, ASXS: shortsHeadless, AUTN: contractsHeadless, NEM: nemHeadless,
  }).map(([code, definition]) => [code, definition.freshness?.source]));
  expect(sources).toEqual({ RBA: "RBA", RBAP: "ASX", ABS: "ABS", ASXA: "ASX", ASXS: "ASIC", AUTN: "AusTender", NEM: "AEMO" });
});
