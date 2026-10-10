import { describe, expect, test } from "bun:test";
import {
  compactMwh,
  composeMap,
  contrastText,
  fitMap,
  MARKET_PRICE_CAP,
  MIN_MAP_WIDTH,
  mapRowsForWidth,
  priceBand,
  stateAt,
  stateLabel,
  type MapState,
} from "./map";

describe("price bands", () => {
  test("each threshold starts the next band", () => {
    expect([-0.01, 0, 49.99, 50, 149.99, 150, 299.99, 300, 4_999, 5_000].map(priceBand)).toEqual([
      "negative", "low", "low", "normal", "normal", "high", "high", "veryHigh", "veryHigh", "extreme",
    ]);
    expect(priceBand(-1_000)).toBe("negative");
    expect(priceBand(MARKET_PRICE_CAP * 0.9 - 1)).toBe("extreme");
    expect(priceBand(MARKET_PRICE_CAP)).toBe("cap");
  });

  test("map labels fit in six characters", () => {
    expect([85.31, -12.4, 999.4, 1_520, MARKET_PRICE_CAP, -1_000].map(compactMwh)).toEqual(["$85", "-$12", "$999", "$1.5k", "$23.2k", "-$1k"]);
    expect(stateLabel("WA", null, false)).toEqual(["WA", "—"]);
    expect(stateLabel("SA", 120, true)).toEqual(["$120"]);
    expect(stateLabel("NT", null, true)).toEqual(["NT"]);
  });
});

describe("geography", () => {
  test("capitals and border towns fall in their states", () => {
    const places: Array<[string, number, number, MapState | null]> = [
      ["Perth", 115.86, -31.95, "WA"],
      ["Darwin", 130.84, -12.46, "NT"],
      ["Alice Springs", 133.88, -23.7, "NT"],
      ["Adelaide", 138.6, -34.93, "SA"],
      ["Brisbane", 153.03, -27.47, "QLD"],
      ["Mount Isa", 139.49, -20.73, "QLD"],
      ["Sydney", 151.0, -33.87, "NSW"],
      ["Canberra", 149.13, -35.28, "NSW"],
      ["Broken Hill", 141.47, -31.95, "NSW"],
      ["Albury", 146.92, -36.08, "NSW"],
      ["Mildura", 142.16, -34.25, "VIC"],
      ["Melbourne", 144.96, -37.81, "VIC"],
      ["Hobart", 147.33, -42.88, "TAS"],
      ["Bass Strait", 146.0, -39.9, null],
      ["Great Australian Bight", 131.0, -34.0, null],
    ];
    for (const [name, lon, lat, state] of places) expect([name, stateAt(lon, lat)]).toEqual([name, state]);
  });

  test("the map keeps its shape: about twice as wide as tall in cells", () => {
    expect(mapRowsForWidth(44)).toBe(20);
    expect(fitMap(200, 20)).toEqual({ width: 44, height: 20 });
    expect(fitMap(30, 50)).toEqual({ width: 30, height: mapRowsForWidth(30) });
    expect(fitMap(MIN_MAP_WIDTH - 1, 50)).toBeNull();
    expect(fitMap(80, mapRowsForWidth(MIN_MAP_WIDTH) - 1)).toBeNull();
  });
});

describe("composed map", () => {
  const cellsOf = (rows: ReturnType<typeof composeMap>, state: MapState) =>
    rows.flatMap((cells, row) => cells.flatMap((cell, column) => (cell.top === state || cell.bottom === state ? [{ row, column }] : [])));

  test("every state has land, west to east and Tasmania south of Victoria", () => {
    const rows = composeMap(44, 20);
    const middle = (state: MapState) => {
      const cells = cellsOf(rows, state);
      expect(cells.length).toBeGreaterThan(0);
      return {
        column: cells.reduce((total, cell) => total + cell.column, 0) / cells.length,
        row: cells.reduce((total, cell) => total + cell.row, 0) / cells.length,
      };
    };
    expect(middle("WA").column).toBeLessThan(middle("SA").column);
    expect(middle("SA").column).toBeLessThan(middle("NSW").column);
    expect(middle("NT").row).toBeLessThan(middle("SA").row);
    expect(middle("QLD").row).toBeLessThan(middle("NSW").row);
    expect(middle("NSW").row).toBeLessThan(middle("VIC").row);
    expect(middle("VIC").row).toBeLessThan(middle("TAS").row);
  });

  test("labels are centred on their state and clamped inside the grid", () => {
    const rows = composeMap(44, 20, { NSW: ["NSW", "$85"], TAS: ["TAS", "$23.2k"] });
    const text = (state: MapState) => rows.map((cells) => cells.filter((cell) => cell.label?.state === state).map((cell) => cell.label!.char).join("")).filter(Boolean);
    expect(text("NSW")).toEqual(["NSW", "$85"]);
    expect(text("TAS")).toEqual(["TAS", "$23.2k"]);
    // NSW's label sits on NSW land.
    const nsw = rows.flatMap((cells) => cells.filter((cell) => cell.label?.state === "NSW"));
    expect(nsw.every((cell) => cell.top === "NSW" && cell.bottom === "NSW")).toBe(true);
    // Tasmania's label sits beside the island and never runs off the edge.
    for (const cells of rows) expect(cells).toHaveLength(44);
    expect(rows.at(-1)!.some((cell) => cell.label?.state === "TAS") || rows.at(-2)!.some((cell) => cell.label?.state === "TAS")).toBe(true);
  });

  test("label text takes whichever colour reads on the fill", () => {
    expect(contrastText("#ffaa00", "#000000", "#ffffff")).toBe("#000000");
    expect(contrastText("#1a1a40", "#000000", "#ffffff")).toBe("#ffffff");
  });
});
