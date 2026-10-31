# RBA rates and the Australian dollar

The `RBA` pane reads the Reserve Bank of Australia's statistical tables directly, so the cash rate is the day's figure rather than a weekly, lagged copy.

## Tabs

- **Rates:** the cash rate target, the interbank overnight cash rate, 1-, 3- and 6-month bank bill swap rates (BBSW), and 2-, 3-, 5- and 10-year and indexed government bond yields. The changes are in basis points over one week, one month and one year.
- **AUD:** the Australian dollar against USD, EUR, JPY, CNY, GBP and NZD, and the trade-weighted index, with percentage changes.
- **Board:** the cash rate target, its last change, the next Monetary Policy Board decision (2:30 pm Sydney time on the second day of each meeting), and every 2026–2027 meeting with the decision taken.

On the Rates and AUD tabs the chart above the table follows the selected row: the series over 1Y, 5Y or all of the table (F1 from 2011, F2 from 2013, F11.1 from 2023), chosen in the bar above it or from the pane menu (`.`). The cash rate target is drawn as steps, since it moves only on decision days. The Board tab charts the cash rate target over the same range, above the meetings.

`o` opens the matching RBA page. `gloomberb fn RBA` prints all three.

## Charts

Every series in the pane is also in Gloomberb's chart catalogue as an "Australian statistics" series (`rba:FIRMMCRTD` for the cash rate, `rba:FCMYGBAG10D` for the 10-year bond, `rba:FXRUSD` for AUD/USD, and so on), so it can be drawn and compared in custom charts.

## Timing

| Table | Contents | Updated |
|---|---|---|
| F1 | Cash rate, interbank rate, BBSW | each business day |
| F2 | Government bond yields | weekly, about a week behind |
| F11.1 | Exchange rates (4 pm Sydney) | each business day |

Each row shows the date of its latest observation; the footer says when the RBA last answered (`updated 3h ago`). The tables are kept on disk, so the pane opens with them at once and checks the RBA again after an hour ([caching](caching.md)). Board meeting dates are a snapshot of the RBA's published schedule and need updating when the RBA publishes 2028.

## Source

RBA statistical tables F1, F2 and F11.1 (rba.gov.au/statistics/tables), CC BY 4.0.
