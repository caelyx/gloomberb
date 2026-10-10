import { describe, expect, test } from "bun:test";
import { F16FormatError, parseF16 } from "./f16";

// Decoded with its BOM kept, as a proxied response body can arrive.
const bytes = await Bun.file(new URL("../../test/fixtures/f16-sample.csv", import.meta.url)).arrayBuffer();
const sample = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe("parseF16 on the RBA file", () => {
  const table = parseF16(sample);

  test("reads the publication date past the BOM and blank header rows", () => {
    expect(sample.charCodeAt(0)).toBe(0xfeff);
    expect(table.published).toBe("2026-09-25");
  });

  test("keeps the Treasury Bond lines and leaves out Treasury Indexed Bonds", () => {
    expect(table.bonds).toHaveLength(52);
    expect(table.bonds.some((bond) => bond.seriesId.endsWith("INDEX"))).toBe(false);
    expect(table.bonds.at(-1)).toEqual({ seriesId: "FCMYJUN54D", maturity: "2054-06-21" });
  });

  test("dated rows only, oldest first, ignoring trailing blank and comma-only lines", () => {
    expect(table.rows).toHaveLength(41);
    expect(table.rows[0]!.date).toBe("2013-05-20");
    expect(table.rows.at(-1)!.date).toBe("2026-09-23");
  });

  test("a ragged row drops its trailing fields and a matured line has no quote", () => {
    const first = table.rows[0]!.yields;
    expect(Object.keys(first)).toHaveLength(6);
    expect(first.FCMYMAY21D).toBe(3.1);
    const latest = table.rows.at(-1)!.yields;
    expect(latest.FCMYAPR15D).toBeUndefined();
    expect(latest.FCMYJUN54D).toBe(5.651);
  });

  test("values follow their series id when a new line is inserted mid-row", () => {
    // Move the last nominal column to the front, as a newly issued line would land among the others.
    const lines = sample.replace(/^\uFEFF/, "").split("\n");
    const moved = lines.map((line) => {
      const cells = line.split(",");
      if (cells.length < 2) return line;
      while (cells.length < 53) cells.push("");
      const [label, ...rest] = cells;
      const [last] = rest.splice(51, 1);
      return [label, last, ...rest].join(",");
    }).join("\n");
    const reordered = parseF16(moved);
    expect(reordered.rows).toEqual(table.rows);
    expect(reordered.bonds.map((bond) => bond.seriesId).toSorted()).toEqual(table.bonds.map((bond) => bond.seriesId).toSorted());
  });

  test("a file without its labelled rows is a format error, not an empty curve", () => {
    expect(() => parseF16("<html>Service unavailable</html>")).toThrow(F16FormatError);
  });
});
