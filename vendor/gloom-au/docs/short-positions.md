# ASX short positions

ASIC requires anyone holding a reportable short position in an ASX product to report it. ASIC adds the reports up per product and publishes the totals each day, four trading days after the positions are held: the report shown on a Friday is for the previous Monday. This is the Australian counterpart of US short interest, but daily rather than twice a month.

## Where it shows

- **`ASXS`**: every product with reported short positions on the latest report, most shorted first, with the change in percentage points over the previous week of reports. Search narrows by code or name; Enter opens the company on its Short positions tab.
- **Ticker Research → Short positions** (ASX listings), and **`ASXS <ticker>`** in its own pane: the latest figure, its one-week and one-month change, the range over the window, a chart of the short percentage, and the daily history. Choose 1M, 3M, or 1Y (one report a week, to keep the download small). The selected row is the chart's cursor: Left and Right step through the reports in time, and clicking the chart selects the nearest one. Days the product was not reported are gaps in the line.
- **`gloomberb fn ASXS [ticker] [--top N] [--window 1M|3M|1Y]`** prints the same tables.

## Reading it

- **Short %** is reported short positions as a share of the product on issue.
- **pp** is percentage points: a move from 12.0% to 12.5% is +0.50 pp. Rising shorts show red, falling shorts green.
- **Not reported** means the product was absent from that day's report. Below the reporting threshold, ASIC lists nothing, so this is not the same as zero.
- The **1W** change in `ASXS` compares with the report five published days earlier. A product missing from that report (a new listing, often a small new ETF, or one that was below the reporting threshold) shows `new` rather than a jump from zero, and sorts after the others on that column. ETFs carry ASIC's short product name ending in `ETF`, since the company directory does not list funds.

Reports are cached on disk once downloaded (a published report never changes), so a long window is slow only the first time. The list of reports is checked again hourly, so the pane opens at once with the last report and picks up a new one behind it ([caching](caching.md)).

## Source

ASIC's daily aggregated short position reports (`download.asic.gov.au/short-selling`). Company names come from the ASX company directory where it has them, because ASIC truncates long names.
