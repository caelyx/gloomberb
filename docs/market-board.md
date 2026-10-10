# ASX market board

`ASXM` is an Australian market overview built from Gloomberb's own quotes and price history (Gloom Cloud, 15 minutes delayed for ASX).

## Market tab

- **Indices:** the S&P/ASX 200, All Ordinaries, S&P/ASX 300 and the S&P/ASX 200 VIX (A-VIX), with the day's change.
- **Sectors:** the eleven S&P/ASX 200 GICS sector indices with the day's change and their returns over one week (5 sessions), one month (21), year to date and one year (252). Enter opens the sector index in Ticker Research.
- **Chart:** the selected sector against the ASX 200 over the past year (the same 252 sessions as the 1Y column, so the legend's figure is the table's), both as percent change from the same start, so the gap between the lines is the difference between their returns. If the ASX 200's history is unavailable, the sector is drawn alone and its caption says so.

### Rotation

The Rotation column places each sector against the ASX 200 the way a relative rotation graph does:

- **Relative strength** is the sector's price divided by the ASX 200's, compared with its own average over the last 50 sessions (above 100 means stronger than usual against the market).
- **Momentum** is the change in that relative strength over the last 10 sessions (above 100 means it is rising).

| | Momentum rising | Momentum falling |
|---|---|---|
| **Relative strength above average** | Leading | Weakening |
| **Relative strength below average** | Improving | Lagging |

Sectors usually move round the quadrants clockwise: Improving, Leading, Weakening, Lagging. This is a simplified, published calculation, not the proprietary JdK RS-Ratio and RS-Momentum, so the numbers will not match a commercial RRG exactly.

## Movers tab

The 100 largest ASX companies by market cap (from the ASX company directory), sortable, most risen first. This approximates the S&P/ASX 100: index membership is licensed data, so the plugin ranks by market cap instead. Enter opens the company.

`gloomberb fn ASXM` prints the indices, sectors and the top ten gainers and losers; `--movers 0` skips the movers scan, which is the slow part.
