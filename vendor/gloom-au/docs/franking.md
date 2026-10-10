# Franking

Australian companies attach franking credits to dividends paid from profits that have already borne company tax. An Australian resident shareholder adds the credit to their taxable income and offsets it against the tax they owe, so a franked dividend is worth more than its cash amount.

## Where it shows

- **Ticker Research → Franking** (ASX shares and funds): the latest dividend with its franking, credit, grossed-up amount, dates and yields, and the dividend history.
- **`FRANK <ticker>`** in the command bar (or search "franking", "dividend" or "imputation") opens Ticker Research on that tab; without a ticker it uses the selected ASX ticker.
- **List columns FRANK% and GROSS YLD**: add them to a portfolio or watchlist from the list's column settings. They stay blank for listings outside the ASX, and fill in a moment after a list first shows an ASX ticker. Each company's figures are kept on disk for later sessions and refreshed after six hours ([caching](caching.md)).
- **`gloomberb au franking <ticker>`** prints the same figures, or JSON with `--json`.

## How the figures are worked out

- **Credit** = cash × franked share × 30 / 70. A fully franked A$1.00 dividend carries a A$0.4286 credit.
- **Grossed up** = cash + credit, which is 1.4286 × cash when fully franked.
- **Gross yield** = cash yield × (1 + franked share × 30 / 70).

Assumptions:

- **30% company tax rate.** Small "base rate entities" frank at 25%, which the data does not reveal; for them the figures overstate the credit slightly.
- **The latest dividend's franking applies to the whole year** for the gross yield. Most companies frank every dividend alike. Where they do not, the gross yield is approximate.
- **Only the latest dividend's franking is known.** The history shows cash amounts for earlier dividends and leaves their franking blank rather than guessing.
- **Amounts are in Australian dollars.** A company that declares in another currency (BHP declares in US dollars) is shown at ASX's AUD amount, with the declared amount beside it.
- **Cash yield:** the tab uses ASX's annual yield on the last close. The GROSS YLD column uses the list's own dividend yield where it has one, so the two can differ slightly.

Your own tax position decides what a credit is worth to you; this is not tax advice.

## Source

ASX's company key statistics (the data behind asx.com.au company pages). The dividend history comes from Gloomberb's own corporate-actions data.
