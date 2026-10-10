import type { ChartSeriesCatalogItem } from "gloomberb/capabilities";
import { AU_CHART_CAPABILITY_ID, type ChartSource } from "../shared/chart-series";
import { intervalSeries, resolvedSeries } from "../shared/series";
import { loadFuelHistory, loadNemHistory, loadOpenElectricityRecent, openElectricityKey } from "./client";
import { FUELS, fuelById, mixHistory, NEM_TOTAL, type FuelReportData, type FuelSpec } from "./fuel";
import { NEM_REGIONS, type PricePoint } from "./model";
import { batteryNet, oeSeries, type OeData } from "./openelectricity";
import { formatNemTime } from "./pane";

type Measure = "price" | "demand";

const FIVE_MINUTES = 300_000;
/** A latest interval older than this means AEMO stopped answering and a cached copy is showing. */
const STALE_MS = 30 * 60_000;

/**
 * What AEMO's public dashboard API serves: the cumulative price report holds
 * seven days of 5-minute prices; the 5-minute report holds 48 hours, with demand.
 */
const MEASURES: Record<Measure, { span: string; unit: string; unitGroup: string; about: string }> = {
  price: {
    span: "7 days",
    unit: "$/MWh",
    unitGroup: "au-nem-price",
    about: "AEMO 5-minute dispatch (spot) price in $/MWh, last 7 days, market time AEST (UTC+10 all year)",
  },
  demand: {
    span: "48 h",
    unit: "MW",
    unitGroup: "au-nem-demand",
    about: "AEMO 5-minute operational demand in MW, last 48 hours, market time AEST (UTC+10 all year)",
  },
};

export const NEM_CHART_SERIES: ChartSeriesCatalogItem[] = (["price", "demand"] as const).flatMap((measure) =>
  Object.entries(NEM_REGIONS).map(([region, name]) => ({
    seriesId: `nem:${region}:${measure}`,
    label: `${name} electricity ${measure} (${MEASURES[measure].span})`,
    description: MEASURES[measure].about,
    detail: "NEM electricity",
    style: "line" as const,
  })));

export function parseNemSeriesId(seriesId: string): { region: string; measure: Measure } | null {
  const match = /^nem:([a-z]+1):(price|demand)$/i.exec(seriesId);
  const region = match?.[1]!.toUpperCase();
  return region && NEM_REGIONS[region] ? { region, measure: match![2]!.toLowerCase() as Measure } : null;
}

/** One region's actual intervals (forecasts dropped) as a chart series. */
export function nemChartSeries(target: { region: string; measure: Measure }, rows: readonly PricePoint[], now = Date.now()) {
  const measure = MEASURES[target.measure];
  const points = rows
    .filter((row) => row.region === target.region && row.actual)
    .flatMap((row) => {
      const value = target.measure === "price" ? row.price : row.demand;
      return value == null ? [] : [{ at: row.at, value }];
    })
    .sort((a, b) => a.at - b.at);
  const name = NEM_REGIONS[target.region]!;
  if (points.length === 0) throw new Error(`AEMO returned no intervals for ${name}`);
  const latest = points.at(-1)!.at;
  return intervalSeries({
    id: `${AU_CHART_CAPABILITY_ID}:nem:${target.region}:${target.measure}`,
    label: `${name} electricity ${target.measure} (${measure.span})`,
    unit: measure.unit,
    unitGroup: measure.unitGroup,
    // Brisbane keeps AEST all year, which is exactly NEM market time.
    timeZone: "Australia/Brisbane",
    cadenceMs: FIVE_MINUTES,
    points,
    ...(now - latest > STALE_MS ? { warning: `AEMO did not refresh; latest interval ${formatNemTime(latest)} AEST` } : {}),
  });
}

/** NEM regional prices and demand as `nem:<region>:price|demand` chart series. */
export const nemChartSource: ChartSource = {
  catalog: () => NEM_CHART_SERIES,
  resolve(seriesId) {
    if (!seriesId.startsWith("nem:") || parseNemFuelSeriesId(seriesId) || parseNemOpenElectricitySeriesId(seriesId)) return null;
    const target = parseNemSeriesId(seriesId);
    if (!target) return Promise.reject(new Error(`Unknown NEM series ${seriesId}`));
    return loadNemHistory(target.measure === "price" ? "prices-7d" : "dispatch-48h")
      .then((rows) => nemChartSeries(target, rows));
  },
};

// --- Generation by fuel ------------------------------------------------------------

const FUEL_REGIONS: Record<string, string> = { ...NEM_REGIONS, [NEM_TOTAL]: "NEM" };

function fuelPhrase(fuel: FuelSpec): string {
  return fuel.id === "battery" ? "battery discharge" : `${fuel.label.toLowerCase()} generation`;
}

/**
 * Each region's (and the NEM's) generation by fuel as daily average MW over
 * the 3-month report, and battery discharge hourly over the 48-hour report
 * so it lines up with the 7-day price series. Many ids, so most are reached
 * by search ("wind", "battery", "generation") rather than the first page.
 */
export const NEM_FUEL_SERIES: ChartSeriesCatalogItem[] = Object.entries(FUEL_REGIONS).flatMap(([region, name]) => [
  {
    seriesId: `nem:${region}:battery`,
    label: `${name} battery discharge (48 h hourly)`,
    description: "AEMO battery discharge, hourly average MW, the 48 hours to the last complete trading day (about 1.5 days behind); charging not reported",
    detail: "NEM generation",
    style: "area" as const,
  },
  ...FUELS.map((fuel) => ({
    seriesId: `nem:${region}:fuel:${fuel.id}`,
    label: `${name} ${fuelPhrase(fuel)} (3M daily)`,
    description: `AEMO generation by fuel: ${fuel.label.toLowerCase()}, daily average MW over the last 3 months${fuel.id === "solar" ? "; utility-scale only, no rooftop PV" : ""}${fuel.id === "battery" ? "; discharge only" : ""}`,
    detail: "NEM generation",
    style: "line" as const,
  })),
]);

export function parseNemFuelSeriesId(seriesId: string): { region: string; fuel: string } | null {
  const match = /^nem:([a-z]+1|nem):(?:fuel:([a-z0-9-]+)|(battery))$/i.exec(seriesId);
  if (!match) return null;
  const region = match[1]!.toUpperCase();
  if (!FUEL_REGIONS[region]) return null;
  if (match[3]) return { region, fuel: "battery-hourly" };
  const fuel = match[2]!.toLowerCase();
  return FUELS.some((entry) => entry.id === fuel) ? { region, fuel } : null;
}

/** Brisbane's calendar date, which is NEM market time. */
function nemDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date(ms));
}

export function nemFuelChartSeries(target: { region: string; fuel: string }, data: FuelReportData) {
  const name = FUEL_REGIONS[target.region]!;
  if (target.fuel === "battery-hourly") {
    const history = mixHistory(data, target.region, "48H");
    const points = history.series.find((entry) => entry.fuel.id === "battery")?.points ?? [];
    if (points.length === 0) throw new Error(`AEMO reported no battery output for ${name}`);
    return {
      ...intervalSeries({
        id: `${AU_CHART_CAPABILITY_ID}:nem:${target.region}:battery`,
        label: `${name} battery discharge (48 h hourly)`,
        unit: "MW",
        unitGroup: "au-nem-mw",
        timeZone: "Australia/Brisbane",
        cadenceMs: 3_600_000,
        points: points.map((point) => ({ at: point.at, value: point.mw })),
      }),
      style: "area" as const,
    };
  }
  const fuel = fuelById(target.fuel)!;
  const history = mixHistory(data, target.region, "3M");
  const points = history.series.find((entry) => entry.fuel.id === fuel.id)?.points ?? [];
  if (points.length === 0) throw new Error(`AEMO reported no ${fuel.label.toLowerCase()} generation for ${name}`);
  return resolvedSeries({
    id: `${AU_CHART_CAPABILITY_ID}:nem:${target.region}:fuel:${fuel.id}`,
    label: `${name} ${fuelPhrase(fuel)} (3M daily)`,
    unit: "MW",
    unitGroup: "au-nem-mw",
    frequency: "daily",
    points: points.map((point) => ({ date: nemDate(point.at), value: point.mw })),
  });
}

/** `nem:<region>:fuel:<fuel>` and `nem:<region>:battery`, regions including `NEM`. */
export const nemFuelChartSource: ChartSource = {
  catalog: () => NEM_FUEL_SERIES,
  resolve(seriesId) {
    const target = parseNemFuelSeriesId(seriesId);
    if (!target) return null;
    return loadFuelHistory(target.fuel === "battery-hourly" ? "48H" : "3M")
      .then((result) => nemFuelChartSeries(target, result.data));
  },
};

// --- OpenElectricity (only with an API key) -------------------------------------------

type OeMeasure = "rooftop" | "battery-net";

const OE_MEASURES: Record<OeMeasure, { label: string; about: string; style: "line" | "area" }> = {
  rooftop: {
    label: "rooftop solar (24 h, 5-min)",
    about: "OpenElectricity rooftop PV estimate, MW at 5 minutes over the last 24 hours (runs about 1.5 hours behind); market time AEST",
    style: "line",
  },
  "battery-net": {
    label: "battery net (24 h, 5-min)",
    about: "OpenElectricity grid batteries, discharge minus charging in MW at 5 minutes over the last 24 hours (negative while charging); market time AEST",
    style: "area",
  },
};

/** Listed only once the user has added an OpenElectricity key, so the catalogue never offers what cannot load. */
export function nemOpenElectricitySeries(): ChartSeriesCatalogItem[] {
  if (!openElectricityKey()) return [];
  return Object.entries(FUEL_REGIONS).flatMap(([region, name]) => (Object.keys(OE_MEASURES) as OeMeasure[]).map((measure) => ({
    seriesId: `nem:${region}:${measure}`,
    label: `${name} ${OE_MEASURES[measure].label}`,
    description: OE_MEASURES[measure].about,
    detail: "NEM generation",
    style: OE_MEASURES[measure].style,
  })));
}

export function parseNemOpenElectricitySeriesId(seriesId: string): { region: string; measure: OeMeasure } | null {
  const match = /^nem:([a-z]+1|nem):(rooftop|battery-net)$/i.exec(seriesId);
  const region = match?.[1]!.toUpperCase();
  return region && FUEL_REGIONS[region] ? { region, measure: match![2]!.toLowerCase() as OeMeasure } : null;
}

export function nemOpenElectricityChartSeries(target: { region: string; measure: OeMeasure }, data: OeData) {
  const name = FUEL_REGIONS[target.region]!;
  const points = target.measure === "rooftop" ? oeSeries(data, target.region, "rooftop") : batteryNet(data, target.region);
  if (points.length === 0) throw new Error(`OpenElectricity reported no ${target.measure === "rooftop" ? "rooftop solar" : "batteries"} for ${name}`);
  return {
    ...intervalSeries({
      id: `${AU_CHART_CAPABILITY_ID}:nem:${target.region}:${target.measure}`,
      label: `${name} ${OE_MEASURES[target.measure].label}`,
      unit: "MW",
      unitGroup: "au-nem-mw",
      timeZone: "Australia/Brisbane",
      cadenceMs: FIVE_MINUTES,
      points: points.map((point) => ({ at: point.at, value: point.mw })),
    }),
    style: OE_MEASURES[target.measure].style,
  };
}

/** `nem:<region>:rooftop` and `nem:<region>:battery-net`, from the same 24-hour request the NEM pane uses. */
export const nemOpenElectricityChartSource: ChartSource = {
  catalog: nemOpenElectricitySeries,
  resolve(seriesId) {
    const target = parseNemOpenElectricitySeriesId(seriesId);
    if (!target) return null;
    const key = openElectricityKey();
    if (!key) return Promise.reject(new Error("Rooftop solar and battery series need an OpenElectricity API key in the plugin's settings"));
    return loadOpenElectricityRecent(key).then((result) => nemOpenElectricityChartSeries(target, result.data));
  },
};
