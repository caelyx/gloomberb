import { describe, expect, test } from "bun:test";
import { ADD_ALERT_WIZARD, INTERVAL_FIELD, parseAddAlertArg } from "./form";
import { createRule } from "./rules";
import { INTERVAL_OPTIONS } from "./service";

describe("the Add ASX Alert form", () => {
  test("its defaults, with a code, make a valid rule", () => {
    const defaults = Object.fromEntries(ADD_ALERT_WIZARD.filter((step) => step.defaultValue != null).map((step) => [step.key, step.defaultValue!]));
    expect(createRule({ ...defaults, code: "BHP" }, [])).toMatchObject({ event: "halt", scope: "ticker", code: "BHP" });
  });

  test("every option it offers is one the rules accept", () => {
    const options = (key: string) => ADD_ALERT_WIZARD.find((step) => step.key === key)!.options!.map((option) => option.value);
    for (const event of options("event")) {
      const extra = event === "dividend-dates" ? {} : { priceSensitive: "yes" };
      expect(() => createRule({ event, scope: "watched", ...extra }, [])).not.toThrow();
    }
    for (const dates of options("dates")) expect(() => createRule({ event: "dividend-dates", scope: "watched", dates }, [])).not.toThrow();
  });

  test("the interval setting offers exactly the intervals the service accepts", () => {
    expect(INTERVAL_FIELD.options.map((option) => Number(option.value))).toEqual([...INTERVAL_OPTIONS]);
  });
});

describe("parseAddAlertArg: AUSA <code>, or the active ASX ticker", () => {
  test("a typed code fills in one company", () => {
    expect(parseAddAlertArg("bhp", { activeTicker: null })).toEqual({ scope: "ticker", code: "BHP" });
    expect(parseAddAlertArg("CBA.AX", { activeTicker: "AAPL" })).toEqual({ scope: "ticker", code: "CBA" });
  });

  test("with nothing typed, an ASX active ticker is used and anything else is not", () => {
    expect(parseAddAlertArg("", { activeTicker: "WES.AX" })).toEqual({ scope: "ticker", code: "WES" });
    expect(parseAddAlertArg("", { activeTicker: "AAPL" })).toEqual({});
    expect(parseAddAlertArg("  ", { activeTicker: null })).toEqual({});
  });
});
