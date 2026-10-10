# ABS indicators

The `ABS` pane reads the Australian Bureau of Statistics' data API for the indicators that move Australian markets, and the ABS release calendar for what comes out next.

## Indicators

| Indicator | Series | Frequency |
|---|---|---|
| CPI, annual | Monthly CPI, all groups, original, annual % change | monthly |
| Trimmed mean CPI, weighted median CPI | Seasonally adjusted, annual % change (the RBA's underlying measures) | monthly |
| Unemployment rate, participation rate | Labour Force, persons, seasonally adjusted | monthly |
| Employment, monthly change | Employed persons, seasonally adjusted, change in thousands | monthly |
| Wage price index, annual | Total hourly rates excluding bonuses, all sectors, seasonally adjusted | quarterly |
| Real GDP, quarterly | Chain volume, seasonally adjusted, % change on the previous quarter | quarterly |
| Real GDP, annual | Worked out from the chain volume level, % change on the same quarter a year earlier | quarterly |

Each row shows the latest value, its period, the one before, and a year earlier. The chart above the table follows the selected row: the indicator's history over 1Y, 5Y or everything loaded (from 15 years back), chosen in the bar above it (or from the pane menu, `.`). Monthly employment change is drawn as columns either side of zero; the rest as lines. The full monthly CPI only began in 2025, so its history is short. Quarter periods read as the quarter's last month ("Jun Q 2026").

## Releases

The **Releases** tab lists what the ABS has scheduled over roughly the next month, at 11:30 am Sydney time unless stated. Headline releases (CPI, Labour Force, wages, national accounts, trade, spending, approvals) are in bold. RBA decision dates are in the `RBA` pane.

## Charts

Besides the chart in the pane, each indicator is a chart series (`abs:cpi`, `abs:cpi-trimmed-mean`, `abs:unemployment`, `abs:participation`, `abs:employment-change`, `abs:wpi`, `abs:gdp-qoq`, `abs:gdp-yoy`) beside the RBA series.

The indicators and release calendar are kept on disk, so the pane opens with them at once and asks the ABS again after six hours; the footer says how old they are ([caching](caching.md)).

## Source

ABS Data API (data.api.abs.gov.au) and the ABS release calendar, CC BY 4.0. `o` opens the matching ABS page; `gloomberb fn ABS` prints both tables.
