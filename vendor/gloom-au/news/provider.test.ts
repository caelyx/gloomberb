import { describe, expect, test } from "bun:test";
import { panelCompany } from "./provider";

describe("panelCompany", () => {
  test("takes the company from a Takeovers Panel title", () => {
    expect(panelCompany("Zenith Minerals Limited 05 – Panel Receives Application")).toBe("Zenith Minerals Limited");
    expect(panelCompany("DGR Global Limited – Further Interim Orders")).toBe("DGR Global Limited");
    expect(panelCompany("Cygnus Metals Limited")).toBe("Cygnus Metals Limited");
  });
});
