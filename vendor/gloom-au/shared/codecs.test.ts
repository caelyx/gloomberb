import { describe, expect, test } from "bun:test";
import { absCalendarCodec, absSeriesCodec } from "../abs/client";
import { announcementsCodec } from "../announcements/client";
import { companiesCodec } from "../directory/client";
import { frankingCodec } from "../franking/client";
import { membersCodec } from "../heatmap/client";
import { rbaTableCodec } from "../rba/client";
import { reportIndexCodec, shortDayCodec } from "../shorts/client";
import { contractsCodec } from "../tenders/client";
import type { DiskCodec } from "./disk-cache";

/** What a restart reads back: encoded, through JSON (as the host stores it), decoded. */
function roundTrip<T, S>(codec: DiskCodec<T, S>, value: T): T {
  return codec.decode(JSON.parse(JSON.stringify(codec.encode(value))) as S);
}

describe("disk codecs", () => {
  test("RBA tables keep every series and point", () => {
    const table = new Map([["FIRMMCRTD", { id: "FIRMMCRTD", title: "Cash Rate Target", units: "Per cent", points: [{ date: "2026-09-30", value: 3.6 }, { date: "2026-10-01", value: 3.6 }] }]]);
    expect(roundTrip(rbaTableCodec, table)).toEqual(table);
    expect(() => rbaTableCodec.decode({ FIRMMCRTD: 3.6 } as never)).toThrow();
  });

  test("ABS series and calendar", () => {
    const points = [{ date: "2026-06-30", value: 2.1, period: "2026-Q2" }];
    expect(roundTrip(absSeriesCodec, points)).toEqual(points);
    const releases = [{ at: Date.parse("2026-10-28T00:30:00Z"), when: "Wednesday 28 October 2026 11:30am AEDT", title: "Consumer Price Index, Australia" }];
    expect(roundTrip(absCalendarCodec, releases)).toEqual(releases);
    expect(() => absSeriesCodec.decode([["2026-06-30"], [2.1], []] as never)).toThrow();
  });

  test("ASIC days and the report index", () => {
    const day = { date: "2026-10-02", rows: [{ code: "PLS", product: "PILBARA MIN FPO", shortPositions: 300_000_000, onIssue: 3_000_000_000, percent: 10 }] };
    expect(roundTrip(shortDayCodec, day)).toEqual(day);
    const index = [{ date: "2026-10-02", url: "https://download.asic.gov.au/short-selling/RR20261002-001-SSDailyAggShortPos.csv" }];
    expect(roundTrip(reportIndexCodec, index)).toEqual(index);
    expect(() => shortDayCodec.decode({ date: "2026-10-02", rows: [["PLS", "PILBARA", "lots", 1, 1]] } as never)).toThrow();
  });

  test("AusTender windows keep completeness and nullable fields", () => {
    const window = {
      complete: false,
      contracts: [{ id: "CN4280996", publishedAt: Date.parse("2026-10-08T00:00:00Z"), agency: "Department of Defence", supplier: "CSL Limited", supplierAbn: null, value: 1_250_000, description: "Vaccines", start: "2026-10-08", end: null, procurementMethod: "Open tender" }],
    };
    expect(roundTrip(contractsCodec, window)).toEqual(window);
    expect(() => contractsCodec.decode({ contracts: [] } as never)).toThrow();
  });

  test("the directory and fund list; an empty list is refused", () => {
    const companies = [{ code: "BHP", name: "BHP GROUP LIMITED", industryGroup: "Materials", listedOn: "1885-08-13", marketCap: 2.2e11 }, { code: "VAS", name: "Vanguard Australian Shares ETF", industryGroup: "ETF", listedOn: null, marketCap: null }];
    expect(roundTrip(companiesCodec, companies)).toEqual(companies);
    expect(() => companiesCodec.decode([])).toThrow();
  });

  test("franking snapshots; an unknown dividend kind is refused", () => {
    const snapshot = { code: "BHP", amount: 0.92, declaredCurrency: "USD", declaredAmount: 0.6, kind: "final" as const, frankingPercent: 100, exDate: "2026-09-04", recordDate: "2026-09-05", payDate: "2026-09-25", annualYield: 0.045 };
    expect(roundTrip(frankingCodec, snapshot)).toEqual(snapshot);
    expect(() => frankingCodec.decode({ ...snapshot, kind: "bonus" } as never)).toThrow();
  });

  test("index members", () => {
    const members = [{ code: "CBA", name: "Commonwealth Bank", marketCap: null, inAsx50: true }];
    expect(roundTrip(membersCodec, members)).toEqual(members);
    expect(() => membersCodec.decode([["CBA", "Commonwealth Bank", null]] as never)).toThrow();
  });

  test("market announcements", () => {
    const items = [{ id: "03012345", code: "BHP", companyName: "BHP GROUP LIMITED", documentKey: "2924-03012345-2A1234567", releasedAt: Date.parse("2026-10-09T22:30:00Z"), headline: "Quarterly Activities Report", priceSensitive: true, category: "periodic" as never, types: ["Quarterly Activities Report"], pages: 12, size: "374.6KB", documentUrl: null }];
    expect(roundTrip(announcementsCodec, items)).toEqual(items);
    expect(() => announcementsCodec.decode([{ id: "x" }] as never)).toThrow();
  });
});
