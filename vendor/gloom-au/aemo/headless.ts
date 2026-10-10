import type { HeadlessBundleSection, HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { refreshNotice } from "../shared/cache-status";
import {
  loadFuelCurrent,
  loadFuelHistory,
  loadNem,
  loadNemHistory,
  loadOpenElectricityHistory,
  loadOpenElectricityRecent,
  openElectricityKeyFrom,
} from "./client";
import { batteryResponse, fuelMix, hourlyPrices, mixHistory, mixRegionName, NEM_TOTAL, summariseHistory, withFuelRows } from "./fuel";
import { formatMw, formatNemStamp, mixRegion, regionCode } from "./generation";
import { priceBandLabel } from "./map";
import { FCAS_SERVICES, NEM_REGIONS, regionDay } from "./model";
import {
  batteryArbitrage,
  currentRows,
  openElectricityLag,
  historyRows,
  OPEN_ELECTRICITY_ATTRIBUTION,
  openElectricityErrorText,
  OPEN_ELECTRICITY_HINT,
  OPEN_ELECTRICITY_KEY_SETTING,
} from "./openelectricity";
import { formatMwh, formatNemTime } from "./pane";

const mwh = (value: unknown) => formatMwh(typeof value === "number" ? value : null);
const mw = (value: unknown) => formatMw(typeof value === "number" ? value : null);
const pct = (value: unknown) => (typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const DATA_LIMITS = "Generation mix: solar is utility-scale only (rooftop PV is not reported); battery is discharge only (charging is not reported); the NEM is the five regions summed.";
const WITH_OPEN_ELECTRICITY = "Generation mix from AEMO, plus rooftop solar and battery charging (negative MW) from OpenElectricity; rooftop PV runs about 1.5 hours behind dispatch; the NEM is the five regions summed.";
/** The plugin's id (`index.tsx`), under which the host keeps its settings. */
const PLUGIN_ID = "au-markets";

/** `gloomberb fn NEM`: NEM spot prices by region, the generation mix, FCAS prices and AEMO market notices. */
export const nemHeadless = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [
    {
      key: "region",
      description: "Region for the fuel-mix detail: the whole NEM, or one of NSW1, QLD1, VIC1, SA1, TAS1.",
      type: "enum",
      values: [{ value: "nem" }, ...Object.keys(NEM_REGIONS).map((region) => ({ value: region.toLowerCase(), aliases: [regionCode(region).toLowerCase()] }))],
      defaultValue: "nem",
    },
  ],
  describe: "NEM electricity prices and generation mix",
  // Five-minute dispatch prices: the host judges how current they are.
  freshness: { source: "AEMO" },
  async load(args, ctx) {
    const region = mixRegion(typeof args.options.region === "string" ? args.options.region.toUpperCase() : NEM_TOTAL);
    const options = { force: ctx.refresh };
    // `fn` runs no setup with the user's settings, so read the key from the config directly. Never printed.
    const oeKey = openElectricityKeyFrom(ctx.config.pluginConfig?.[PLUGIN_ID]?.[OPEN_ELECTRICITY_KEY_SETTING]);
    const [{ summary, prices }, currentAemo, historyAemo, week, oeRecent] = await Promise.all([
      loadNem(options),
      loadFuelCurrent(options).catch((error: unknown) => error as Error),
      loadFuelHistory("48H", options).catch((error: unknown) => error as Error),
      // Seven days of 5-minute prices: the hourly mix ends about 1.5 days back, past the 24-hour report.
      region === NEM_TOTAL && !oeKey ? null : loadNemHistory("prices-7d", options).catch(() => null),
      oeKey ? loadOpenElectricityRecent(oeKey, options).catch((error: unknown) => error as Error) : null,
    ]);
    const historyTimes = historyAemo instanceof Error ? [] : [...new Set(historyAemo.data.rows.map((row) => row.at))].sort((a, b) => a - b);
    const oeHistory = oeKey && historyTimes.length
      ? await loadOpenElectricityHistory(oeKey, "48H", historyTimes, options).catch((error: unknown) => error as Error)
      : null;
    const oeErrors = [oeRecent, oeHistory].filter((entry): entry is Error => entry instanceof Error);
    const recent = oeRecent && !(oeRecent instanceof Error) ? oeRecent.data : null;
    let lagging = "";
    const current = currentAemo instanceof Error || !recent ? currentAemo : (() => {
      const at = currentAemo.rows.reduce((max, row) => Math.max(max, row.at), Number.NEGATIVE_INFINITY);
      const extra = currentRows(recent, at);
      lagging = openElectricityLag(at, extra);
      return withFuelRows(currentAemo, extra.rows);
    })();
    const history = historyAemo instanceof Error || !oeHistory || oeHistory instanceof Error
      ? historyAemo
      : { ...historyAemo, data: withFuelRows(historyAemo.data, historyRows(oeHistory.data, "48H", historyTimes)) };
    const now = Date.now();
    const errors: string[] = [];
    const sections: HeadlessBundleSection[] = [
      {
        title: `Prices, ${summary.regions[0] ? `${formatNemTime(summary.regions[0].at)} AEST` : "latest interval"}`,
        columns: [
          { key: "region", header: "Region" },
          { key: "price", header: "$/MWh", align: "right", format: mwh },
          { key: "conditions", header: "Conditions" },
          { key: "average", header: "24h avg", align: "right", format: mwh },
          { key: "low", header: "24h low", align: "right", format: mwh },
          { key: "high", header: "24h high", align: "right", format: mwh },
          { key: "demand", header: "Demand MW", align: "right", format: mw },
        ],
        rows: summary.regions.map((entry) => {
          const day = regionDay(prices, entry.region, now);
          return { region: NEM_REGIONS[entry.region] ?? entry.region, id: entry.region, price: entry.price, conditions: priceBandLabel(entry.price), average: day.average, low: day.low, high: day.high, demand: entry.demand };
        }),
      },
    ];

    if (current instanceof Error) {
      errors.push(`Generation mix unavailable: ${message(current)}`);
    } else {
      const regions = Object.keys(NEM_REGIONS);
      const nem = fuelMix(current, NEM_TOTAL);
      const mixes = new Map(regions.map((id) => [id, fuelMix(current, id)]));
      if (nem) {
        sections.push({
          title: `Generation by fuel (MW), ${formatNemTime(nem.at)} AEST${lagging ? ` (${lagging})` : ""}`,
          columns: [
            { key: "fuel", header: "Fuel" },
            ...regions.map((id) => ({ key: id, header: regionCode(id), align: "right" as const, format: mw })),
            { key: "nem", header: "NEM", align: "right", format: mw },
            { key: "share", header: "NEM %", align: "right", format: pct },
          ],
          rows: [
            ...nem.fuels.map((entry) => ({
              fuel: entry.fuel.label,
              ...Object.fromEntries(regions.map((id) => [id, mixes.get(id)?.fuels.find((own) => own.fuel.id === entry.fuel.id)?.mw ?? null])),
              nem: entry.mw,
              // Battery charging is a load, not a share of generation (also at 0 MW).
              share: entry.fuel.id === "battery-charging" ? null : entry.share,
            })),
            { fuel: "Total", ...Object.fromEntries(regions.map((id) => [id, mixes.get(id)?.total ?? null])), nem: nem.total, share: 1 },
          ],
        });
      }
    }

    if (history instanceof Error) {
      errors.push(`Generation history unavailable: ${message(history)}`);
    } else {
      const window = mixHistory(history.data, region, "48H");
      const first = window.times[0];
      const last = window.times.at(-1);
      if (first != null && last != null) {
        const hourly = week ? hourlyPrices(week, region, window.times) : null;
        sections.push({
          title: `${mixRegionName(region)} fuel mix, hourly, ${formatNemStamp(first - 3_600_000, true)} to ${formatNemStamp(last, true)} AEST`,
          columns: [
            { key: "fuel", header: "Fuel" },
            { key: "average", header: "Avg MW", align: "right", format: mw },
            { key: "peak", header: "Peak MW", align: "right", format: mw },
            { key: "peakAt", header: "Peak hour ending" },
            { key: "share", header: "Energy %", align: "right", format: pct },
          ],
          rows: summariseHistory(window).map((entry) => ({
            fuel: entry.fuel.label,
            average: entry.average,
            peak: entry.peak?.mw ?? null,
            peakAt: entry.peak && Math.round(entry.peak.mw) !== 0 ? formatNemStamp(entry.peak.at, true) : "—",
            share: entry.fuel.id === "battery-charging" ? null : entry.share,
          })),
        });
        const battery = window.series.find((entry) => entry.fuel.id === "battery");
        const charging = window.series.find((entry) => entry.fuel.id === "battery-charging");
        if (battery && hourly && region !== NEM_TOTAL) {
          const response = batteryResponse(battery.points, hourly, charging?.points);
          sections.push({
            title: `${mixRegionName(region)} batteries against the hourly average spot price`,
            entries: [
              { label: "Average spot price", value: response.averagePrice, formatted: mwh(response.averagePrice) },
              { label: "Discharge-weighted price", value: response.dischargePrice, formatted: mwh(response.dischargePrice) },
              ...(charging ? [{ label: "Charge-weighted price", value: response.chargePrice, formatted: mwh(response.chargePrice) }] : []),
              ...(response.peak ? [{ label: "Peak discharge", value: response.peak.mw, formatted: `${formatMw(response.peak.mw)} MW, hour ending ${formatNemStamp(response.peak.at, true)} AEST at ${mwh(response.peak.price)}` }] : []),
            ],
          });
        }
      }
    }

    if (recent && week) {
      const arbitrage = batteryArbitrage(recent, week, region);
      const span = recent.rows.filter((row) => row.fuel !== "rooftop").map((row) => row.at);
      if (arbitrage.intervals > 0 && span.length) {
        const peak = (point: typeof arbitrage.peakDischarge) => (point ? `${formatMw(point.mw)} MW at ${formatNemTime(point.at)} AEST, ${mwh(point.price)}` : "—");
        sections.push({
          title: `${mixRegionName(region)} batteries against the 5-minute spot price, ${formatNemStamp(Math.min(...span), true)} to ${formatNemStamp(Math.max(...span), true)} AEST`,
          entries: [
            { label: "Sold at (discharge-weighted)", value: arbitrage.soldAt, formatted: mwh(arbitrage.soldAt) },
            { label: "Charged at (charge-weighted)", value: arbitrage.boughtAt, formatted: mwh(arbitrage.boughtAt) },
            { label: "Spread", value: arbitrage.spread, formatted: mwh(arbitrage.spread) },
            // The price report has no demand to weight the regions by, so the NEM's is their plain mean.
            { label: region === NEM_TOTAL ? "Average spot price (simple mean of the regions)" : "Average spot price", value: arbitrage.averagePrice, formatted: mwh(arbitrage.averagePrice) },
            { label: "Discharged", value: arbitrage.dischargedMwh, formatted: `${formatMw(arbitrage.dischargedMwh)} MWh` },
            { label: "Charged", value: arbitrage.chargedMwh, formatted: `${formatMw(arbitrage.chargedMwh)} MWh` },
            { label: "Peak discharge", value: arbitrage.peakDischarge?.mw ?? null, formatted: peak(arbitrage.peakDischarge) },
            { label: "Peak charging", value: arbitrage.peakCharge?.mw ?? null, formatted: peak(arbitrage.peakCharge) },
          ],
        });
      }
    }

    if (summary.fcas.length) {
      const regions = Object.keys(NEM_REGIONS).filter((id) => summary.fcas.some((entry) => entry.region === id));
      sections.push({
        title: "FCAS prices ($/MW/h), latest interval",
        columns: [{ key: "service", header: "Service" }, ...regions.map((id) => ({ key: id, header: regionCode(id), align: "right" as const, format: mwh }))],
        rows: FCAS_SERVICES.map((service) => ({
          service: service.label,
          ...Object.fromEntries(regions.map((id) => [id, summary.fcas.find((entry) => entry.region === id)?.prices[service.key] ?? null])),
        })),
      });
    }

    sections.push({
      title: "Market notices",
      columns: [{ key: "time", header: "AEST" }, { key: "type", header: "Type" }, { key: "notice", header: "Notice" }],
      rows: summary.notices.map((notice) => ({ time: formatNemTime(notice.at), type: notice.type, notice: notice.title })),
    });

    errors.push(...oeErrors.map(openElectricityErrorText));
    return {
      sections,
      notes: [
        ...(oeKey ? [WITH_OPEN_ELECTRICITY, OPEN_ELECTRICITY_ATTRIBUTION] : [DATA_LIMITS, OPEN_ELECTRICITY_HINT]),
        ...(history instanceof Error ? [] : refreshNotice(history)),
      ],
      ...(errors.length ? { errors, complete: false } : {}),
    };
  },
} satisfies HeadlessPaneDefinition<"bundle">;
