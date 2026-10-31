import { assetDataProvider } from "gloomberb/capabilities";
import type { GloomPlugin, PaneTemplateContext, PaneTemplateCreateOptions } from "gloomberb/types/plugin";
import { parsePublicTickerKey } from "gloomberb/utils";
import { AlertsPane } from "./alerts/pane";
import { INTERVAL_FIELD } from "./alerts/form";
import { AULRT_PANE_ID, AULRT_TEMPLATE_ID, setupAlerts } from "./alerts/setup";
import { absChartSource } from "./abs/chart";
import { absHeadless } from "./abs/headless";
import { ABS_PANE_ID, AbsPane } from "./abs/pane";
import { nemChartSource, nemFuelChartSource, nemOpenElectricityChartSource } from "./aemo/chart";
import { setupOpenElectricity } from "./aemo/settings";
import { OPEN_ELECTRICITY_KEY_SETTING } from "./aemo/openelectricity";
import { nemHeadless } from "./aemo/headless";
import { NEM_PANE_ID, NemPane } from "./aemo/pane";
import { announcementsHeadless } from "./announcements/headless";
import { attachCompanyFeed, setAnnouncementAccessToken } from "./announcements/company-feed";
import { ANNOUNCEMENTS_PANE_ID, ANNOUNCEMENTS_TAB_ID, AnnouncementsPane } from "./announcements/pane";
import { AnnouncementsTab } from "./announcements/tab";
import { boardHeadless } from "./board/headless";
import { BOARD_PANE_ID, BoardPane } from "./board/pane";
import { auCliCommand } from "./cli";
import { heatmapHeadless } from "./heatmap/headless";
import { toSource, toUniverse } from "./heatmap/model";
import { GROUP_SETTING, HEATMAP_PANE_ID, HeatmapPane } from "./heatmap/pane";
import { createAsxSearchProvider } from "./directory/search";
import { FRANKING_TAB_ID, registerFrankingCommand } from "./franking/command";
import { frankingPercentColumn, grossYieldColumn } from "./franking/columns";
import { FrankingTab } from "./franking/tab";
import { createAuNewsCapability } from "./news/provider";
import { asxOptionsProvider } from "./options/provider";
import { rbaHeadless } from "./rba/headless";
import { RBA_PANE_ID, RbaPane } from "./rba/pane";
import { rbapHeadless } from "./rbap/headless";
import { CURRENT_TARGET_SETTING, HISTORY_SETTING, RBAP_PANE_ID, RbapPane } from "./rbap/pane";
import { HISTORY_MONTHS, historyMonths } from "./rbap/view";
import { asxCodeForTicker, asxCodeFromSymbol } from "./shared/asx";
import { attachDiskCaches } from "./shared/disk-cache";
import { createAuChartSeriesCapability, registerChartSource } from "./shared/chart-series";
import { shortsHeadless } from "./shorts/headless";
import { SHORTS_PANE_ID, SHORTS_TAB_ID, ShortPositionsPane } from "./shorts/pane";
import { ShortPositionsTab } from "./shorts/tab";
import { contractsHeadless } from "./tenders/headless";
import { ContractsPane, TENDERS_PANE_ID } from "./tenders/pane";

export const PLUGIN_ID = "au-markets";

let stopAlerts: (() => void) | null = null;

registerChartSource(absChartSource);
registerChartSource(nemChartSource);
registerChartSource(nemFuelChartSource);
registerChartSource(nemOpenElectricityChartSource);

/**
 * `ASXA BHP` opens one company. These are ASX-only functions, so a code the
 * user typed or picked is read as an ASX code even when the listing picker
 * chose another venue (VAS lists Vienna's VAS first). With no argument the
 * active ticker is used only if it is an ASX listing; otherwise the market feed opens.
 */
function templateCode(context: PaneTemplateContext, options?: PaneTemplateCreateOptions): string | null {
  // The host passes the picked listing's key as the argument (`VAS:XWBO`); keep its symbol.
  const explicit = options?.arg?.trim() || options?.searchResult?.symbol;
  if (explicit) return asxCodeFromSymbol(explicit) ?? asxCodeFromSymbol(parsePublicTickerKey(explicit).symbol, "ASX");
  return asxCodeForTicker(options?.ticker ?? null, options?.symbol ?? context.activeTicker);
}

/** A pane that shows the whole market, or one ASX company when given a ticker. */
function marketOrCompany(paneId: string, prefix: string) {
  return (context: PaneTemplateContext, options?: PaneTemplateCreateOptions) => {
    const code = templateCode(context, options);
    return code
      ? { instanceId: `${paneId}:${code}`, title: `${prefix} ${code}`, binding: { kind: "fixed" as const, symbol: `${code}.AX` }, placement: "floating" as const }
      : { placement: "floating" as const };
  };
}

export const auMarketsPlugin: GloomPlugin = {
  id: PLUGIN_ID,
  name: "Australian Markets",
  version: "0.2.0",
  description: "Australian market data from free public sources: ASX announcements and alerts, franking, options and short positions, RBA rates, ABS indicators, an ASX market board and heatmap, Australian news, government contracts and electricity prices",
  homepage: "https://github.com/caelyx/gloom-au",
  toggleable: true,

  // Plain HTTPS. None of these hosts send CORS headers, so the web app could
  // only reach them through its proxy; see the README on web support.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.asx.com.au", "asx.api.markitdigital.com", "download.asic.gov.au", "www.asic.gov.au", "www.rba.gov.au", "data.api.abs.gov.au", "www.abs.gov.au", "www.abc.net.au", "api.tenders.gov.au", "cdn.cboe.com", "cdn-api.markitdigital.com", "visualisations.aemo.com.au", "takeovers.gov.au", "www.tga.gov.au", "scanner.tradingview.com", "api.openelectricity.org.au"],
  configSchema: [
    {
      key: "announcementsAccessToken",
      label: "ASX document access token",
      type: "password",
      required: false,
      description: "Leave empty. Only needed if announcement PDFs stop opening with a 401 or 403; see docs/announcements.md.",
    },
    {
      key: OPEN_ELECTRICITY_KEY_SETTING,
      label: "OpenElectricity API key",
      type: "password",
      required: false,
      description: "Optional. Adds rooftop solar and battery charging to NEM's generation views. Free (non-commercial) key from platform.openelectricity.org.au; see docs/nem.md.",
    },
    INTERVAL_FIELD,
  ],
  cliCommands: [auCliCommand],
  capabilities: [assetDataProvider(asxOptionsProvider), createAuChartSeriesCapability(), createAuNewsCapability()],

  panes: [
    {
      id: AULRT_PANE_ID,
      name: "ASX Alerts",
      icon: "!",
      component: AlertsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 24 },
      tableExport: true,
    },
    {
      id: ANNOUNCEMENTS_PANE_ID,
      name: "ASX Announcements",
      icon: "A",
      component: AnnouncementsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 120, height: 28 },
      tableExport: true,
      headless: announcementsHeadless,
    },
    {
      id: SHORTS_PANE_ID,
      name: "ASX Short Positions",
      icon: "S",
      component: ShortPositionsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 30 },
      tableExport: true,
      headless: shortsHeadless,
    },
    {
      id: RBA_PANE_ID,
      name: "RBA",
      icon: "R",
      component: RbaPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 26 },
      tableExport: true,
      headless: rbaHeadless,
    },
    {
      id: RBAP_PANE_ID,
      name: "RBA Path",
      icon: "P",
      component: RbapPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 30 },
      tableExport: true,
      headless: rbapHeadless,
      settings: (context) => ({
        title: "RBA Path Settings",
        values: {
          [HISTORY_SETTING]: historyMonths(context.settings[HISTORY_SETTING]),
          [CURRENT_TARGET_SETTING]: context.settings[CURRENT_TARGET_SETTING] !== false,
        },
        fields: [
          {
            key: HISTORY_SETTING,
            label: "Actual target before the path",
            type: "select",
            options: HISTORY_MONTHS.map((option) => ({ value: option.value, label: option.label })),
            description: "How far back the chart's yellow target line starts: the actual cash rate target (from RBA table F1) before the implied path.",
          },
          {
            key: CURRENT_TARGET_SETTING,
            label: "Current target line",
            type: "toggle",
            description: "Carry today's cash rate target flat across the meetings, so the implied path reads against it.",
          },
        ],
      }),
    },
    {
      id: ABS_PANE_ID,
      name: "ABS",
      icon: "E",
      component: AbsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 22 },
      tableExport: true,
      headless: absHeadless,
    },
    {
      id: BOARD_PANE_ID,
      name: "ASX Market",
      icon: "M",
      component: BoardPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 28 },
      tableExport: true,
      headless: boardHeadless,
    },
    {
      id: TENDERS_PANE_ID,
      name: "AusTender Contracts",
      icon: "G",
      component: ContractsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 130, height: 28 },
      tableExport: true,
      headless: contractsHeadless,
    },
    {
      id: NEM_PANE_ID,
      name: "NEM Electricity",
      icon: "W",
      component: NemPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 30 },
      tableExport: true,
      headless: nemHeadless,
    },
    {
      id: HEATMAP_PANE_ID,
      name: "ASX Heatmap",
      icon: "H",
      component: HeatmapPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 36 },
      headless: heatmapHeadless,
      settings: (context) => {
        // Ranked by market cap, the boards are the largest companies, not the indices.
        const ranked = toSource(context.settings.source) === "market-cap";
        const top50 = ranked ? "Top 50 by market cap" : "ASX 50";
        const top200 = ranked ? "Top 200 by market cap" : "ASX 200";
        return {
        title: "ASX Heatmap Settings",
        values: {
          universe: toUniverse(context.settings.universe),
          [GROUP_SETTING]: context.settings[GROUP_SETTING] !== false,
          source: toSource(context.settings.source),
        },
        fields: [
          {
            key: "universe",
            label: "Board",
            type: "select",
            options: [
              { value: "asx50", label: top50 },
              { value: "asx200", label: top200 },
              { value: "sectors", label: "GICS sector indices" },
            ],
            description: "Company tiles are sized by each company's whole market cap, not its weight in the index.",
          },
          {
            key: GROUP_SETTING,
            label: "Group by sector",
            type: "toggle",
            description: `Lay out the ${top50} and ${top200} in sector blocks; off for one flat map.`,
          },
          {
            key: "source",
            label: "Constituents",
            type: "select",
            options: [
              { value: "tradingview", label: "TradingView scanner (index members)" },
              { value: "market-cap", label: "Top N by market cap" },
            ],
            description: "Index membership from TradingView's scanner, falling back to the largest companies by market cap when it fails; or always the largest companies.",
          },
        ],
        };
      },
    },
  ],

  paneTemplates: [
    {
      id: AULRT_TEMPLATE_ID,
      paneId: AULRT_PANE_ID,
      label: "ASX Alerts",
      description: "Alerts on ASX announcements (results, dividends, trading halts or any) and coming dividend dates, for a company, your holdings or the whole market.",
      keywords: ["alerts", "alrt", "aulrt", "asx", "trading halt", "halt", "dividend", "ex-dividend", "earnings", "results", "announcements", "notify", "australia"],
      shortcut: { prefix: "AULRT" },
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "au-announcements-pane",
      paneId: ANNOUNCEMENTS_PANE_ID,
      label: "ASX Announcements",
      description: "Company announcements lodged with ASX: the market feed, or one company's with an ASX ticker.",
      keywords: ["asx", "announcements", "australia", "disclosure", "price sensitive", "appendix 3y", "substantial holder", "filings"],
      shortcut: {
        prefix: "ASXA",
        // gloom-asx's shortcut, so its users keep their habit.
        aliases: ["ASX"],
        argPlaceholder: "ASX ticker",
        argKind: "ticker",
        argOptional: true,
        openWithoutArg: true,
      },
      headless: announcementsHeadless,
      createInstance: marketOrCompany(ANNOUNCEMENTS_PANE_ID, "ASXA"),
    },
    {
      id: "asx-short-positions-pane",
      paneId: SHORTS_PANE_ID,
      label: "ASX Short Positions",
      description: "ASIC's daily report of short positions in ASX products, most shorted first, or one company's history with an ASX ticker.",
      keywords: ["asx", "short", "short interest", "short positions", "asic", "shorted", "australia"],
      shortcut: { prefix: "ASXS", argPlaceholder: "ASX ticker", argKind: "ticker", argOptional: true, openWithoutArg: true },
      headless: shortsHeadless,
      createInstance: marketOrCompany(SHORTS_PANE_ID, "ASXS"),
    },
    {
      id: "au-rba-pane",
      paneId: RBA_PANE_ID,
      label: "RBA Rates",
      description: "RBA cash rate, bank bill rates, government bond yields, the Australian dollar and board decision dates.",
      keywords: ["rba", "cash rate", "australia", "bbsw", "bank bill", "government bond", "acgb", "aud", "reserve bank", "interest rates", "yield curve"],
      shortcut: { prefix: "RBA" },
      headless: rbaHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "au-rbap-pane",
      paneId: RBAP_PANE_ID,
      label: "RBA Rate Path",
      description: "The RBA cash rate path priced by ASX 30-day interbank cash rate futures: implied rate, move odds and the odds of each 25 bp target level at each board meeting.",
      keywords: ["rba", "cash rate", "rate path", "wirp", "rate expectations", "futures", "interbank", "ib futures", "rate tracker", "probability", "australia", "reserve bank"],
      shortcut: { prefix: "RBAP", aliases: ["WIRA"] },
      headless: rbapHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "au-abs-pane",
      paneId: ABS_PANE_ID,
      label: "ABS Indicators",
      description: "Australian CPI, labour force, wages and GDP from the ABS, and upcoming ABS releases.",
      keywords: ["abs", "australia", "cpi", "inflation", "unemployment", "jobs", "labour force", "wages", "wpi", "gdp", "economic calendar", "releases"],
      shortcut: { prefix: "ABS" },
      headless: absHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "asx-market-pane",
      paneId: BOARD_PANE_ID,
      label: "ASX Market",
      description: "ASX 200, All Ords and A-VIX, the 11 GICS sectors with returns and rotation against the ASX 200, and the day's biggest movers.",
      keywords: ["asx", "asx 200", "xjo", "all ords", "a-vix", "vix", "sectors", "gics", "rotation", "movers", "gainers", "losers", "australia", "market"],
      shortcut: { prefix: "ASXM" },
      headless: boardHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "au-contracts-pane",
      paneId: TENDERS_PANE_ID,
      label: "AusTender Contracts",
      description: "Australian Government contracts published on AusTender, largest first, with ASX-listed suppliers marked.",
      keywords: ["austender", "government contracts", "awards", "procurement", "tenders", "australia", "commonwealth"],
      shortcut: { prefix: "AUTN" },
      headless: contractsHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "au-nem-pane",
      paneId: NEM_PANE_ID,
      label: "NEM Electricity",
      description: "Wholesale electricity spot prices and demand across the National Electricity Market, the generation mix by fuel, battery discharge against price, FCAS prices and AEMO market notices.",
      keywords: ["nem", "aemo", "electricity", "power", "spot price", "energy", "australia", "wholesale", "generation", "fuel mix", "coal", "gas", "wind", "solar", "rooftop solar", "battery", "battery charging", "renewables", "fcas"],
      shortcut: { prefix: "NEM" },
      headless: nemHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "au-heatmap-pane",
      paneId: HEATMAP_PANE_ID,
      label: "ASX Heatmap",
      description: "The ASX 50, ASX 200 or the 11 GICS sector indices, sized by market cap, coloured by the day's move and grouped by sector.",
      keywords: ["heatmap", "asx", "asx 50", "asx 200", "xjo", "xfl", "australia", "market", "sectors", "gics", "treemap"],
      // gloom-asx's shortcut, kept.
      shortcut: { prefix: "HMA" },
      headless: heatmapHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    // Every disk cache (CACHE_POLICY in shared/cache-policy.ts) lives in the host's plugin persistence.
    attachDiskCaches(ctx.persistence);
    attachCompanyFeed(ctx.persistence);
    setAnnouncementAccessToken(ctx.configState.get<string>("announcementsAccessToken"));
    // The key outside React (chart series, headless), kept in step with the settings, and the command to clear it.
    setupOpenElectricity(ctx);
    ctx.registerTickerResearchTab({
      id: ANNOUNCEMENTS_TAB_ID,
      name: "Announcements",
      order: 45,
      component: AnnouncementsTab,
      instruments: ["equity", "fund"],
      isVisible: ({ ticker }) => asxCodeForTicker(ticker) !== null,
    });
    ctx.registerTickerResearchTab({
      id: FRANKING_TAB_ID,
      name: "Franking",
      order: 46,
      component: FrankingTab,
      instruments: ["equity", "fund"],
      isVisible: ({ ticker }) => asxCodeForTicker(ticker) !== null,
    });
    ctx.registerTickerResearchTab({
      id: SHORTS_TAB_ID,
      name: "Short positions",
      order: 47,
      component: ShortPositionsTab,
      instruments: ["equity", "fund"],
      isVisible: ({ ticker }) => asxCodeForTicker(ticker) !== null,
    });
    ctx.registerColumn(frankingPercentColumn);
    ctx.registerColumn(grossYieldColumn);
    ctx.registerCommandBarSearchProvider(createAsxSearchProvider(ctx));
    registerFrankingCommand(ctx);
    // AULRT: background checks of ASX announcements and dividend dates, and the Add ASX Alert command.
    stopAlerts?.();
    stopAlerts = setupAlerts(ctx);
  },

  dispose() {
    stopAlerts?.();
    stopAlerts = null;
  },
};

export default auMarketsPlugin;
