# Australian Markets for Gloomberb

A [Gloomberb](https://github.com/gloom-sh/gloomberb) plugin that brings Australian (ASX) market data closer to what the app offers for US listings, using free public sources. It installs on top of the official Gloomberb build; nothing in Gloomberb itself needs to change.

```bash
gloomberb install caelyx/gloom-au
```

It replaces [gloom-asx](https://github.com/caelyx/gloom-asx): everything gloom-asx did (company announcements with PDF extracts, the `ASX` shortcut) is here, so uninstall gloom-asx after installing this (`gloomberb remove gloom-asx`).

Requires Gloomberb 0.16.0 or newer. Works in the terminal and the desktop app (see [Web](#web) for the hosted web app).

## What it adds

| Where | What |
|---|---|
| `ASXA` pane | The latest announcements across the ASX in Sydney time, with All / Price sensitive / Directors / Substantial tabs. Enter opens the company. |
| `ASXA <ticker>` (or `ASX <ticker>`), Ticker Research → **Announcements** | One company's whole announcement history, paged on scroll, with an inline extract of each PDF, other issuers' notices about the company marked, and type, price-sensitive and own-only filters. |
| Ticker Research → **Franking** (`FRANK <ticker>`) | Latest dividend with franking %, credit, grossed-up amount, dates, cash and gross yield; dividend history. |
| List columns **FRANK%**, **GROSS YLD** | Franking and grossed-up yield for ASX holdings in any portfolio or watchlist. |
| `ASXS` / `ASXS <ticker>`, Ticker Research → **Short positions** | ASIC daily short positions: most shorted products with weekly change, and each company's history with a chart. |
| `RBA` pane | Cash rate, BBSW, government bond yields, the AUD and RBA board decisions; the selected series charted over 1Y, 5Y or all history, and every series also in custom charts. |
| `RBAP` pane (alias `WIRA`) | The RBA path priced by ASX 30-day interbank cash rate futures, like `WIRP` for the Fed: implied cash rate target and move odds at each board meeting (published dates, then estimated ones marked `~`), a step chart with 1W/1M/1Y look-backs as daily history builds, and the futures strip. |
| `ABS` pane | CPI (headline, trimmed mean, weighted median), unemployment, participation, jobs, wages, GDP; upcoming ABS releases; the selected indicator charted in the pane, and all in custom charts. |
| `ASXM` pane | ASX 200, All Ords, ASX 300 and A-VIX; the 11 GICS sectors with returns, rotation and a one-year chart against the ASX 200; movers among the 100 largest companies. |
| `HMA` pane | ASX heatmap: the ASX 50, ASX 200 or the 11 GICS sector indices, sized by market cap, coloured by the day's move and grouped by sector. |
| `OMON`, Ticker Research → **Options**, `gloomberb options` | ASX exchange-traded options (every listed expiry, 20 minutes delayed) in Gloomberb's own options views. |
| `AUTN` pane | AusTender government contracts, largest first, with ASX-listed suppliers marked. |
| `NEM` pane | National Electricity Market. **Prices:** each region's spot price and demand on a map of Australia coloured by price conditions, with the 24-hour range. **Generation** and **Mix history:** the mix by fuel (coal, gas, hydro, wind, utility solar, battery) now and over 48 hours, 3 months or 12 months, with battery discharge charted against price. **FCAS** prices and AEMO market **Notices**. Prices, demand and the fuel mix per region are also series in custom charts. |
| NEM with an OpenElectricity key (optional) | A free OpenElectricity API key, added in the plugin's settings, adds rooftop solar and battery charging to Generation and Mix history, and a 24-hour view of batteries against the 5-minute price. Without a key nothing is requested from OpenElectricity. |
| News feeds (`N`, `TOP`, `gloomberb news`) | ABC business headlines, RBA media releases, ASIC media releases (the latest 20), Takeovers Panel matters and TGA notices, and price-sensitive announcements from the 300 largest ASX companies. |
| Command bar → **ASX Listings** | ASX companies, ETFs and funds by code or name, exact code first and then largest by market cap (ASX's search merged with Gloomberb's, so "vanguard australian" leads with VAS). |
| `gloomberb fn ASXA`, `ASXS`, `RBA`, `RBAP`, `ABS`, `ASXM`, `HMA`, `AUTN`, `NEM` | Every pane as a terminal report, also `--json` or `--csv`; `gloomberb catalog <name>` lists its options. |
| `gloomberb au franking <ticker>` | Franking figures from the terminal. |
| Local cache | Panes open with their last data at once and refresh behind it; see [caching](docs/caching.md). |

Docs: [announcements](docs/announcements.md), [franking](docs/franking.md), [options](docs/options.md), [short positions](docs/short-positions.md), [RBA](docs/rba.md), [RBA rate path](docs/rbap.md), [ABS](docs/abs.md), [market board](docs/market-board.md), [heatmap](docs/heatmap.md), [news](docs/news.md), [AusTender](docs/austender.md), [NEM](docs/nem.md), [caching](docs/caching.md).

## Data and terms

| Data | Source | Terms |
|---|---|---|
| Company announcements | asx.com.au company announcements pages | ASX: free for private and personal use; commercial use needs ASX's written authority |
| Market-wide announcements, dividends and franking, options chains, cash rate futures, company directory and search | The JSON and CSV behind asx.com.au (`asx.api.markitdigital.com`; PDFs on `cdn-api.markitdigital.com`) | As above; unofficial and may change without notice |
| Short positions | ASIC daily aggregated short position reports | ASIC public data; attribute ASIC |
| Rates, exchange rates, board dates | RBA statistical tables and meeting schedule | CC BY 4.0 |
| Economic indicators, release calendar | ABS Data API and release calendar | CC BY 4.0 |
| Business headlines | ABC News business RSS | ABC: headline and link only |
| Takeovers Panel, TGA notices | takeovers.gov.au and tga.gov.au RSS | Commonwealth material, linked |
| ASIC media releases | The JSON behind ASIC's newsroom page (download.asic.gov.au; unofficial and may change) | CC BY 4.0 (© Australian Securities & Investments Commission), linked |
| Government contracts | AusTender OCDS API | CC BY 3.0 AU |
| Electricity prices | AEMO NEM data dashboard | AEMO: personal use with attribution |
| Rooftop solar, battery charging (optional) | OpenElectricity API (`api.openelectricity.org.au`), with the user's own key | CC BY 4.0 with attribution to OpenElectricity; the free Community plan is for non-commercial use |
| Fund list fallback | TMX Australia tradable-securities list (cdn.cboe.com) | TMX: personal non-commercial use |
| ASX 50 and ASX 200 membership (heatmap) | TradingView stock scanner (`scanner.tradingview.com`) | Undocumented and keyless; TradingView's terms do not allow automated access. Optional: the heatmap can rank by market cap instead |
| Company list fallback | `ASXListedCompanies.csv` on asx.com.au | ASX: personal use |

Each user's own Gloomberb fetches this data directly, for that user's own use. Do not proxy it through a shared server or redistribute it. No source here needs an API key; OpenElectricity is optional and off until you add your own.

## Web

The hosted web app at term.gloom.sh does not install plugins (the `web` target in `gloom.json` is for builds that bundle the plugin). These hosts also send no CORS headers, so a browser could only reach them through the web app's proxy. Use the terminal or desktop app.

## Development

```bash
bun install
# Link a Gloomberb checkout so there is one copy of gloomberb and react:
mkdir -p node_modules
ln -sfn /path/to/gloomberb node_modules/gloomberb
ln -sfn /path/to/gloomberb/node_modules/react node_modules/react
bun run typecheck
bun test

# Try it in the app against a throwaway profile
GLOOMBERB_HOME=~/.cache/gloom-au-dev gloomberb plugin link .
GLOOMBERB_HOME=~/.cache/gloom-au-dev gloomberb plugin doctor gloom-au   # the link is named after the checkout folder
GLOOMBERB_HOME=~/.cache/gloom-au-dev gloomberb fn ASXA BHP.AX
```

CI (`.github/workflows/ci.yml`) does the same linking against the Gloomberb revision pinned in `GLOOMBERB_REVISION` there, then runs the typecheck and tests.

## Known limits

- Quotes and history come from Gloomberb itself: ASX prices are 15 minutes delayed there, options 20.
- ASIC publishes no RSS feed: the plugin reads the latest 20 media releases from the data behind ASIC's newsroom page. ASIC's published notices (insolvency and similar) are not included.
- Electricity: without an OpenElectricity key, utility solar excludes rooftop solar and batteries show discharge only (AEMO's dashboard data); see [NEM](docs/nem.md).
- Some gaps can only be closed in Gloomberb itself (ASX trading holidays, analytics that accept US listings only, a few built-in panes that misread ASX data); see the [parity plan](docs/australian-data-parity.md) and [STATUS.md](STATUS.md).

