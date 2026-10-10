import { describe, expect, test } from "bun:test";
import { formatDay, formatReleased, sydneyToday } from "./time";

describe("Sydney date formats", () => {
  test("a day prints as dd Mon yyyy; anything else passes through", () => {
    expect(formatDay("2026-10-05")).toBe("05 Oct 2026");
    expect(formatDay(null)).toBe("—");
    expect(formatDay("Oct 2026")).toBe("Oct 2026");
  });

  test("an instant takes its Sydney calendar day", () => {
    // 14:30 UTC on 9 Oct is 01:30 AEDT on 10 Oct.
    expect(sydneyToday(Date.parse("2026-10-09T14:30:00Z"))).toBe("2026-10-10");
    expect(formatReleased(Date.parse("2026-10-09T14:30:00Z"), Date.parse("2026-10-10T00:00:00Z"))).toBe("10 Oct 01:30");
  });
});
