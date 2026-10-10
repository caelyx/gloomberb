import { describe, expect, test } from "bun:test";
import { frankingCredit, grossedUpYield, grossUpFactor, parseKeyStatistics } from "./model";

describe("franking maths", () => {
  test("a fully franked dollar carries 30/70 of a dollar in credit; unfranked carries none", () => {
    expect(frankingCredit(2.7, 100)).toBeCloseTo(1.157143, 6);
    expect(frankingCredit(2.7, 0)).toBe(0);
    expect(frankingCredit(1, 50)).toBeCloseTo(0.214286, 6);
    expect(grossUpFactor(100)).toBeCloseTo(1.428571, 6);
    // Out-of-range percentages are clamped, not extrapolated.
    expect(frankingCredit(1, 140)).toBeCloseTo(frankingCredit(1, 100), 9);
    expect(grossedUpYield(0.0336, 100)).toBeCloseTo(0.048, 4);
    expect(grossedUpYield(null, 100)).toBeNull();
    expect(grossedUpYield(0.03, null)).toBeNull();
  });
});

describe("parseKeyStatistics", () => {
  test("an AUD dividend", () => {
    const snapshot = parseKeyStatistics({ data: {
      dividend: 2.7, dividendCurrency: "AUD", dividendType: "F", frankingPercent: 100, foreignCurrencyAmount: 0,
      dateExDate: "2026-08-19", datePayDate: "2026-09-29", dateRecordDate: "2026-08-20", yieldAnnual: 3.3583826561149164,
    } }, "CBA");
    expect(snapshot).toEqual({
      code: "CBA", amount: 2.7, declaredCurrency: "AUD", declaredAmount: null, kind: "final", frankingPercent: 100,
      exDate: "2026-08-19", recordDate: "2026-08-20", payDate: "2026-09-29", annualYield: 0.033583826561149164,
    });
  });

  test("a dividend declared in USD keeps the AUD amount and records what was declared", () => {
    const snapshot = parseKeyStatistics({ data: {
      dividend: 1.3799, dividendCurrency: "USD", dividendType: "F", frankingPercent: 100, foreignCurrencyAmount: 0.99,
    } }, "BHP");
    expect(snapshot).toMatchObject({ amount: 1.3799, declaredCurrency: "USD", declaredAmount: 0.99 });
  });

  test("missing or nonsensical fields become unknowns, and a missing body is a format error", () => {
    const snapshot = parseKeyStatistics({ data: { dividend: 0, frankingPercent: 250, dividendType: "X" } }, "XYZ");
    expect(snapshot).toMatchObject({ amount: null, frankingPercent: null, kind: "other", exDate: null, annualYield: null });
    expect(() => parseKeyStatistics({ error: { code: 404 } }, "XYZ")).toThrow(/not recognised/);
  });
});
