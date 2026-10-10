import { describe, expect, test } from "bun:test";
import { derive, parseReleaseCalendar, parseSdmxCsv, periodDate, type AbsSeriesDef } from "./model";

describe("parseSdmxCsv", () => {
  test("reads TIME_PERIOD and OBS_VALUE by header, sorted, skipping blanks", () => {
    const csv = "DATAFLOW,MEASURE,INDEX,TSEST,REGION,FREQ,TIME_PERIOD,OBS_VALUE\n"
      + "ABS:CPI(2.0.0),3,10001,10,50,M,2026-08,4\n"
      + "ABS:CPI(2.0.0),3,10001,10,50,M,2026-07,3.5\n"
      + "ABS:CPI(2.0.0),3,10001,10,50,M,2026-06,\n";
    expect(parseSdmxCsv(csv)).toEqual([
      { period: "2026-07", date: "2026-07-01", value: 3.5 },
      { period: "2026-08", date: "2026-08-01", value: 4 },
    ]);
    expect(() => parseSdmxCsv("NoRecordsFound")).toThrow(/not recognised/);
  });

  test("quarters start on their first month", () => {
    expect(periodDate("2026-Q2")).toBe("2026-04-01");
    expect(periodDate("2026-Q4")).toBe("2026-10-01");
    expect(periodDate("2026")).toBeNull();
  });
});

describe("derive", () => {
  const level = [
    { period: "2025-Q1", date: "2025-01-01", value: 100 },
    { period: "2025-Q2", date: "2025-04-01", value: 101 },
    { period: "2025-Q3", date: "2025-07-01", value: 102 },
    { period: "2025-Q4", date: "2025-10-01", value: 103 },
    { period: "2026-Q1", date: "2026-01-01", value: 104 },
    { period: "2026-Q2", date: "2026-04-01", value: 105 },
  ];
  test("year-on-year growth from a quarterly level and monthly change from a level", () => {
    const yoy = derive({ derive: "yoy", frequency: "quarterly" } as AbsSeriesDef, level);
    expect(yoy.map((point) => point.value)).toEqual([4, 3.96]);
    const change = derive({ derive: "change", frequency: "monthly" } as AbsSeriesDef, level.slice(0, 3));
    expect(change.map((point) => point.value)).toEqual([1, 1]);
  });
});

describe("parseReleaseCalendar", () => {
  test("pairs each release stamp with its title and converts AEDT and AEST to UTC", () => {
    const html = `<div class="release-calendar">
      <div>Thursday 15 October 2026 11:30am AEDT</div><h3><a>Labour Force, Australia</a></h3>
      <div>Wednesday 14 October 2026 11:30am AEDT</div><span>|</span><p>Updated information</p>
      <div>Wednesday 29 July 2026 11:30am AEST</div><h3>Consumer Price Index, Australia</h3>
    </div>`;
    const releases = parseReleaseCalendar(html);
    expect(releases.map((release) => [new Date(release.at).toISOString(), release.title])).toEqual([
      ["2026-07-29T01:30:00.000Z", "Consumer Price Index, Australia"],
      ["2026-10-15T00:30:00.000Z", "Labour Force, Australia"],
    ]);
  });
});
