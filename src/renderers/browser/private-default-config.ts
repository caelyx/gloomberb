import type { SavedLayout } from "../../types/config";

/**
 * Downstream (private deployment): the workspace and theme a fresh browser
 * opens with.
 *
 * Used only when the browser has no saved config. A returning visitor's saved
 * config always wins, and nothing here is written over it. The first layout
 * opens; a research deep link (`/?ticker=...`) opens upstream's Research layout
 * first instead. Set `PRIVATE_DEFAULT_LAYOUTS` or `PRIVATE_DEFAULT_THEME` to
 * null to go back to upstream's first-visit layouts or theme.
 *
 * Taken from a desktop config backup: its `layouts` (the active one first) and
 * `theme`; nothing else in it is carried over. Left out of the layouts:
 * gloom-abcnews's `abc-news` pane, which the web build does not have, the news
 * pane's cached headlines and the portfolio cursor. The Sovereign board is
 * written as `cdx-board` on its `sovereign` tab, the form config version 25
 * folds `sovr-board` into.
 *
 * `paneId` is the pane a plugin registers; `instanceId` is any unique name of
 * the form `<paneId>:<suffix>`. Some panes read Gloom Cloud and may ask the
 * visitor to sign in.
 */
export const PRIVATE_DEFAULT_THEME: string | null = "amber";

export const PRIVATE_DEFAULT_LAYOUTS: readonly SavedLayout[] | null = [
  {
    name: "Home",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.501,
        first: {
          kind: "split",
          axis: "vertical",
          ratio: 0.355,
          first: { kind: "pane", instanceId: "chart-composer:home" },
          second: {
            kind: "split",
            axis: "vertical",
            ratio: 0.5,
            first: {
              kind: "split",
              axis: "horizontal",
              ratio: 0.35,
              first: { kind: "pane", instanceId: "quote-monitor:muqqfxid4" },
              second: { kind: "pane", instanceId: "chart-composer:mumjtlvla" },
            },
            second: { kind: "pane", instanceId: "chart-composer:mumjmnv77" },
          },
        },
        second: {
          kind: "split",
          axis: "vertical",
          ratio: 0.539,
          first: { kind: "pane", instanceId: "hackernews:muqpejnd1" },
          second: { kind: "pane", instanceId: "news-top:home" },
        },
      },
      instances: [
        {
          instanceId: "chart-composer:home",
          paneId: "chart-composer",
          binding: { kind: "fixed", symbol: "WBC" },
          settings: {
            chartSpec: {
              panels: [{ id: "main" }, { id: "volume", label: "Volume", height: 0.24 }],
              series: [
                {
                  id: "wbc-market-ohlcv-1",
                  axis: "auto",
                  style: "line",
                  source: {
                    kind: "security",
                    period: "auto",
                    fieldId: "market.ohlcv",
                    instrument: { symbol: "WBC" },
                  },
                  panelId: "main",
                  transform: "raw",
                  interpolation: "none",
                },
                {
                  id: "axfj-market-ohlcv-2",
                  axis: "right",
                  style: "line",
                  source: {
                    kind: "security",
                    period: "auto",
                    fieldId: "market.ohlcv",
                    instrument: { symbol: "^AXFJ", exchange: "ASX" },
                  },
                  panelId: "main",
                  transform: "raw",
                  interpolation: "none",
                },
              ],
              studies: [
                {
                  id: "builtin:volume:wbc-market-ohlcv-1",
                  axis: "auto",
                  kind: "volume",
                  panelId: "volume",
                  parameters: {},
                  inputSeriesIds: ["wbc-market-ohlcv-1"],
                },
              ],
              version: 2,
              viewport: { range: "3M", resolution: "auto" },
            },
            chartDrawings: [],
          },
          placementMemory: { docked: { anchorInstanceId: "quote-monitor:muqqfxid4", position: "above" } },
        },
        {
          instanceId: "news-top:home",
          paneId: "news-top",
          binding: { kind: "none" },
          placementMemory: { docked: { anchorInstanceId: "hackernews:muqpejnd1", position: "below" } },
        },
        {
          instanceId: "chart-composer:mumjmnv77",
          paneId: "chart-composer",
          title: "G AUDUSD=X · AUDGBP=X · AUDEUR=X",
          binding: { kind: "fixed", symbol: "AUDUSD=X" },
          settings: {
            chartSpec: {
              panels: [{ id: "main" }],
              series: [
                {
                  id: "audusd-x-market-ohlcv-1",
                  axis: "auto",
                  style: "line",
                  source: {
                    kind: "security",
                    period: "auto",
                    fieldId: "market.ohlcv",
                    instrument: { symbol: "AUDUSD=X" },
                  },
                  panelId: "main",
                  transform: "raw",
                  interpolation: "none",
                },
                {
                  id: "audgbp-x-market-ohlcv-2",
                  axis: "auto",
                  style: "line",
                  source: {
                    kind: "security",
                    period: "auto",
                    fieldId: "market.ohlcv",
                    instrument: { symbol: "AUDGBP=X" },
                  },
                  panelId: "main",
                  transform: "raw",
                  interpolation: "none",
                },
                {
                  id: "audeur-x-market-ohlcv-3",
                  axis: "auto",
                  style: "line",
                  source: {
                    kind: "security",
                    period: "auto",
                    fieldId: "market.ohlcv",
                    instrument: { symbol: "AUDEUR=X" },
                  },
                  panelId: "main",
                  transform: "raw",
                  interpolation: "none",
                },
              ],
              studies: [],
              version: 2,
              viewport: { range: "1M", resolution: "auto" },
            },
          },
          placementMemory: {
            docked: { anchorInstanceId: "chart-composer:mumjtlvla", position: "below" },
            floating: { x: 50, y: 31, width: 100, height: 32 },
          },
        },
        {
          instanceId: "chart-composer:mumjtlvla",
          paneId: "chart-composer",
          title: "GP ^AXJO",
          binding: { kind: "fixed", symbol: "^AXJO", instrument: null },
          settings: {
            chartSpec: {
              panels: [{ id: "main" }, { id: "volume", label: "Volume", height: 0.24 }],
              series: [
                {
                  id: "axjo-market-ohlcv-1",
                  axis: "auto",
                  style: "line",
                  source: {
                    kind: "security",
                    period: "auto",
                    fieldId: "market.ohlcv",
                    instrument: { symbol: "^AXJO", instrument: null },
                  },
                  panelId: "main",
                  transform: "raw",
                  interpolation: "none",
                },
              ],
              studies: [
                {
                  id: "builtin:volume:axjo-market-ohlcv-1",
                  axis: "auto",
                  kind: "volume",
                  panelId: "volume",
                  parameters: {},
                  inputSeriesIds: ["axjo-market-ohlcv-1"],
                },
              ],
              version: 2,
              viewport: { range: "3M", resolution: "auto" },
            },
          },
          placementMemory: {
            docked: { anchorInstanceId: "quote-monitor:muqqfxid4", position: "right" },
            floating: { x: 27, y: 28, width: 100, height: 32 },
          },
        },
        {
          instanceId: "hackernews:muqpejnd1",
          paneId: "hackernews",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "news-top:home", position: "above" },
            floating: { x: 50, y: 10, width: 110, height: 34 },
          },
        },
        {
          instanceId: "quote-monitor:muqqfxid4",
          paneId: "quote-monitor",
          title: "CBA.AX · NAB.AX +2",
          binding: { kind: "fixed", symbol: "CBA.AX" },
          settings: {
            symbol: "CBA.AX",
            symbols: ["CBA.AX", "NAB.AX", "ANZ.AX", "MQG.AX"],
            symbolsText: "CBA.AX, NAB.AX, ANZ.AX, MQG.AX",
            liveStreaming: false,
          },
          placementMemory: {
            docked: { anchorInstanceId: "chart-composer:mumjtlvla", position: "left" },
            floating: { x: 69, y: 22, width: 72, height: 10 },
          },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: { "hackernews:muqpejnd1": { pluginState: { hackernews: { feed: "top" } } } },
    focusedPaneId: "chart-composer:home",
  },
  {
    name: "ASX",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "vertical",
        ratio: 0.139,
        first: { kind: "pane", instanceId: "portfolio-list:muqs9dx4g" },
        second: {
          kind: "split",
          axis: "horizontal",
          ratio: 0.685,
          first: { kind: "pane", instanceId: "au-heatmap:mv25h7q82" },
          second: { kind: "pane", instanceId: "asx-short-positions:mv272yp46" },
        },
      },
      instances: [
        {
          instanceId: "portfolio-list:muqs9dx4g",
          paneId: "portfolio-list",
          binding: { kind: "none" },
          params: { collectionId: "main" },
          placementMemory: {
            docked: { anchorInstanceId: "au-heatmap:mv25h7q82", position: "above" },
            floating: { x: 42, y: 11, width: 126, height: 32 },
          },
        },
        {
          instanceId: "au-heatmap:mv25h7q82",
          paneId: "au-heatmap",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "asx-short-positions:mv272yp46", position: "left" },
            floating: { x: 50, y: 9, width: 110, height: 36 },
          },
        },
        {
          instanceId: "asx-short-positions:mv272yp46",
          paneId: "asx-short-positions",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "au-heatmap:mv25h7q82", position: "right" },
            floating: { x: 50, y: 12, width: 110, height: 30 },
          },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: {
      "portfolio-list:muqs9dx4g": { collectionId: "main" },
      "asx-short-positions:mv272yp46": { pluginState: { "au-markets": { selectedCode: "DRO" } } },
    },
    focusedPaneId: "asx-short-positions:mv272yp46",
  },
  {
    name: "NMAP",
    layout: {
      dockRoot: { kind: "pane", instanceId: "newsmap:muns3ap59" },
      instances: [
        {
          instanceId: "newsmap:muns3ap59",
          paneId: "newsmap",
          binding: { kind: "none" },
          settings: { source: "google" },
          placementMemory: { floating: { x: 68, y: 10, width: 110, height: 36 } },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: { "newsmap:muns3ap59": { pluginState: { newsmap: { hidden: [] } } } },
    focusedPaneId: "newsmap:muns3ap59",
  },
  {
    name: "Futures",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "futures:muqssosdp" },
        second: {
          kind: "split",
          axis: "vertical",
          ratio: 0.5,
          first: {
            kind: "split",
            axis: "horizontal",
            ratio: 0.5,
            first: { kind: "pane", instanceId: "acgb-curve:muzl1m7rg" },
            second: { kind: "pane", instanceId: "yield-curve:mv26fb3v4" },
          },
          second: {
            kind: "split",
            axis: "horizontal",
            ratio: 0.5,
            first: { kind: "pane", instanceId: "au-rba:mv25lvni6" },
            second: { kind: "pane", instanceId: "au-rbap:mv28s7wn5" },
          },
        },
      },
      instances: [
        {
          instanceId: "futures:muqssosdp",
          paneId: "futures",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "acgb-curve:muzl1m7rg", position: "left" },
            floating: { x: 0, y: 0, width: 105, height: 54 },
          },
        },
        {
          instanceId: "acgb-curve:muzl1m7rg",
          paneId: "acgb-curve",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "yield-curve:mv26fb3v4", position: "left" },
            floating: { x: 59, y: 13, width: 92, height: 28 },
          },
        },
        {
          instanceId: "au-rba:mv25lvni6",
          paneId: "au-rba",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "au-rbap:mv28s7wn5", position: "left" },
            floating: { x: 57, y: 14, width: 96, height: 26 },
          },
        },
        {
          instanceId: "yield-curve:mv26fb3v4",
          paneId: "yield-curve",
          binding: { kind: "none" },
          settings: { asOfDate: "" },
          placementMemory: {
            docked: { anchorInstanceId: "acgb-curve:muzl1m7rg", position: "right" },
            floating: { x: 59, y: 13, width: 92, height: 28 },
          },
        },
        {
          instanceId: "au-rbap:mv28s7wn5",
          paneId: "au-rbap",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "au-rba:mv25lvni6", position: "right" },
            floating: { x: 57, y: 12, width: 96, height: 30 },
          },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: {
      "acgb-curve:muzl1m7rg": { pluginState: { "acgb-curve": { "acgb:us": false } } },
      "au-rba:mv25lvni6": { pluginState: { "au-markets": { selected: "FCMYGBAG10D", tab: "rates" } } },
      "yield-curve:mv26fb3v4": { pluginState: { macro: { "yield-curve:tab": "world" } } },
    },
    focusedPaneId: "au-rbap:mv28s7wn5",
  },
  {
    name: "Monitor",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.42,
        first: { kind: "pane", instanceId: "econ-calendar:main" },
        second: {
          kind: "split",
          axis: "vertical",
          ratio: 0.5,
          first: { kind: "pane", instanceId: "world-indices:main" },
          second: { kind: "pane", instanceId: "news-top:main" },
        },
      },
      instances: [
        {
          instanceId: "news-top:main",
          paneId: "news-top",
          binding: { kind: "none" },
          placementMemory: { docked: { anchorInstanceId: "world-indices:main", position: "below" } },
        },
        {
          instanceId: "world-indices:main",
          paneId: "world-indices",
          binding: { kind: "none" },
          placementMemory: { docked: { anchorInstanceId: "news-top:main", position: "above" } },
        },
        {
          instanceId: "econ-calendar:main",
          paneId: "econ-calendar",
          binding: { kind: "none" },
          placementMemory: { docked: { anchorInstanceId: "world-indices:main", position: "left" } },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: {
      "econ-calendar:main": {
        pluginState: {
          macro: { selectedKey: "ff-73", openKey: null, impactFilter: "all", countryFilter: "all" },
        },
      },
    },
    focusedPaneId: "econ-calendar:main",
  },
  {
    name: "US",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.723,
        first: { kind: "pane", instanceId: "market-heatmap:mumjvzqkc" },
        second: { kind: "pane", instanceId: "fear-greed:mumjw2yad" },
      },
      instances: [
        {
          instanceId: "market-heatmap:mumjvzqkc",
          paneId: "market-heatmap",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "fear-greed:mumjw2yad", position: "left" },
            floating: { x: 45, y: 29, width: 110, height: 36 },
          },
        },
        {
          instanceId: "fear-greed:mumjw2yad",
          paneId: "fear-greed",
          binding: { kind: "none" },
          placementMemory: {
            docked: { anchorInstanceId: "market-heatmap:mumjvzqkc", position: "right" },
            floating: { x: 63, y: 19, width: 110, height: 36 },
          },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: { "market-heatmap:mumjvzqkc": { collectionKind: "portfolio" } },
    focusedPaneId: "market-heatmap:mumjvzqkc",
  },
  {
    name: "Macro",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "vertical",
        ratio: 0.54,
        first: {
          kind: "split",
          axis: "horizontal",
          ratio: 0.58,
          first: { kind: "pane", instanceId: "market-valuation:macro" },
          second: { kind: "pane", instanceId: "cdx-board:mv20rc3914" },
        },
        second: {
          kind: "split",
          axis: "horizontal",
          ratio: 0.58,
          first: { kind: "pane", instanceId: "econ-statistics:macro" },
          second: {
            kind: "split",
            axis: "vertical",
            ratio: 0.5,
            first: { kind: "pane", instanceId: "credit-conditions:macro" },
            second: { kind: "pane", instanceId: "volatility-term-structure:macro" },
          },
        },
      },
      instances: [
        {
          instanceId: "market-valuation:macro",
          paneId: "market-valuation",
          binding: { kind: "none" },
          settings: { range: "25Y", indicator: "buffett" },
          placementMemory: { docked: { anchorInstanceId: "cdx-board:mv20rc3914", position: "left" } },
        },
        {
          instanceId: "econ-statistics:macro",
          paneId: "econ-statistics",
          binding: { kind: "none" },
          settings: { stat: "cpi-yoy", range: "20Y" },
          placementMemory: { docked: { anchorInstanceId: "credit-conditions:macro", position: "left" } },
        },
        {
          instanceId: "volatility-term-structure:macro",
          paneId: "volatility-term-structure",
          binding: { kind: "none" },
          placementMemory: { docked: { anchorInstanceId: "credit-conditions:macro", position: "below" } },
        },
        {
          instanceId: "credit-conditions:macro",
          paneId: "credit-conditions",
          binding: { kind: "none" },
          placementMemory: { docked: { anchorInstanceId: "volatility-term-structure:macro", position: "above" } },
        },
        {
          instanceId: "cdx-board:mv20rc3914",
          paneId: "cdx-board",
          binding: { kind: "none" },
          params: { tab: "sovereign" },
          placementMemory: {
            docked: { anchorInstanceId: "market-valuation:macro", position: "right" },
            floating: { x: 57, y: 13, width: 96, height: 28 },
          },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: {
      "volatility-term-structure:macro": { pluginState: { macro: { selectedIndexId: "vix9d" } } },
      "credit-conditions:macro": { pluginState: { macro: { selected: "BAMLC0A2CAA", open: null } } },
    },
    focusedPaneId: "credit-conditions:macro",
  },
  {
    name: "Temp",
    layout: {
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "au-nem:mv1wlc32a" },
        second: {
          kind: "split",
          axis: "vertical",
          ratio: 0.5,
          first: { kind: "pane", instanceId: "asx-market:mv23gjr0a" },
          second: { kind: "pane", instanceId: "asx-short-positions:mv23el7f6" },
        },
      },
      instances: [
        {
          instanceId: "au-nem:mv1wlc32a",
          paneId: "au-nem",
          binding: { kind: "none" },
          placementMemory: { floating: { x: 0, y: 0, width: 105, height: 27 } },
        },
        {
          instanceId: "asx-short-positions:mv23el7f6",
          paneId: "asx-short-positions",
          binding: { kind: "none" },
          placementMemory: {
            docked: { path: [1, 1], anchorInstanceId: "asx-market:mv23gjr0a", position: "below" },
            floating: { x: 8, y: 21, width: 110, height: 30 },
          },
        },
        {
          instanceId: "asx-market:mv23gjr0a",
          paneId: "asx-market",
          binding: { kind: "none" },
          placementMemory: {
            docked: { path: [1, 0], anchorInstanceId: "asx-short-positions:mv23el7f6", position: "above" },
            floating: { x: 53, y: 20, width: 110, height: 28 },
          },
        },
      ],
      floating: [],
      detached: [],
    },
    paneState: {
      "au-nem:mv1wlc32a": { pluginState: { "au-markets": { tab: "prices", mixRange: "3M", region: "NEM" } } },
      "asx-short-positions:mv23el7f6": { pluginState: { "au-markets": { selectedCode: "DRO", query: "" } } },
      "asx-market:mv23gjr0a": { pluginState: { "au-markets": { tab: "market", sector: "^AXFJ", mover: "DPM" } } },
    },
    focusedPaneId: "au-nem:mv1wlc32a",
  },
];
