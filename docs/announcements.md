# ASX announcements

ASX publishes every company announcement as soon as it is released to the market. This plugin shows them two ways:

- **One company** (`ASXA BHP`, `ASX BHP`, and the Announcements tab in Ticker Research): the company's whole announcement history, newest first, 50 at a time; scrolling loads older ones. Enter opens an announcement with an extract of its PDF; `o` opens the PDF, `w` the company's page on asx.com.au. Figures above the list give the company's full name, its total number of announcements on ASX, and when it last released a price-sensitive one.
- **The market** (`ASXA` with no ticker): the feed asx.com.au uses for its market announcements page, carrying ASX's own announcement types. The pane shows the latest 500 announcements (about a day and a half); the Directors and Substantial tabs filter those, while Price sensitive asks ASX for its own latest 500 price-sensitive ones. Enter opens the company; `o` opens the announcement's PDF.

## One company's list

- **Other issuers' notices:** a company's feed also carries notices other issuers lodged about it, such as a fund manager's substantial-holder notice. Those rows start with the lodging issuer's code (`CAR · Becoming a substantial holder from CBA`) and the detail says who lodged it. For an ETF the feed is the fund manager's, so it also carries the manager's other funds. The **Own only** toggle (query bar `Own`, labelled with the company's code) hides both.
- **Filters:** Type and Price sensitive (query bar `PS`) narrow the loaded rows. While a filter shows fewer than 20 rows, the view loads up to ten more pages to fill it.
- **Extract:** the first two pages of the PDF, cleaned of the ASX watermark, running headers and page counters, cut to whole sentences within about 2,000 characters. The note under it says how much of the document it covers. When a PDF cannot be read (too large, scanned, encrypted, refused, or the download failed), the detail says so and `o` still opens it; `r` retries.
- **Caching:** lists are kept on disk and refreshed after 15 minutes, so a pane opens at once with the last list, marked stale until the refresh lands. Extracts are kept for 30 days (a published PDF does not change). The market feed is kept too, refreshed after two minutes ([caching](caching.md)).
- **Fallback:** if ASX's feed is unavailable, the view falls back to the company's announcements page on asx.com.au: six months, no paging and no extracts.
- **Access token:** PDFs download without one today. If ASX ever starts refusing them (401 or 403), the plugin's settings take the site-wide token the asx.com.au front end uses; open any announcement from asx.com.au in a browser and copy the `access_token` value from the PDF's address.

`gloomberb fn ASXA BHP.AX [--period M6|YYYY]` prints a company's list from the asx.com.au page (six months or a year). `bun run probe:asx CBA --pdf` in the plugin checks the live endpoints with three requests.

Times are Sydney time (AEST or AEDT), as ASX publishes them: `08 Oct 09:23` this year and `08 Oct 2025` before it, in both the market pane and a company's list; an open announcement gives the full stamp with its zone.

## Price sensitive

An asterisk (`*`) marks an announcement ASX flagged as price sensitive (in the market pane's PS column, and before the headline in a company's list, whose **Price sensitive** toggle, `PS` in the query bar, shows only those; the figures above the list give when the company last released one): it may move the share price, and ASX released it to the market before anything else. On the market pane, the Price sensitive tab asks ASX for price-sensitive announcements only, so it reaches further back than filtering the latest rows would.

## Types

ASX's notice types are standard under the listing rules, so the plugin groups announcements by their headline (and, on the market feed, ASX's type labels):

| Type | Includes |
|---|---|
| Trading halts | Trading halts, suspensions and reinstatements to quotation (`Halt`) |
| ASX queries | Price and aware queries, responses to ASX (`ASX query`) |
| Results | Appendix 4C, 4D, 4E; half-year and full-year results; annual and quarterly reports; results presentations |
| Director interests | Appendix 3X (initial), 3Y (change) and 3Z (final) director's interest notices: the Australian counterpart of US Form 4 insider filings |
| Substantial holders | Becoming, changing or ceasing to be a substantial holder (Forms 603, 604, 605): holders of 5% or more, the nearest counterpart of US 13D/13G |
| Takeovers | Bidder's and target's statements, schemes of arrangement, compulsory acquisition |
| Dividends | Dividend and distribution announcements, DRP prices |
| Capital | Appendix 2A, 3B–3H; placements, entitlement offers, share purchase plans, buy-backs, cleansing notices, prospectuses |
| Meetings | Notices of meeting, proxy forms, results of meeting, letters to holders |
| Other | Everything else, including top-20 holder reports and operational updates; ASX's own type label shows when it has one |

The grouping is a reading aid, not ASX's classification. A headline that fits two groups lands in one, in this order: trading halts, ASX queries, top-20 holder reports (by headline only, as ASX also tags annual reports with a top-20 type), director interests, substantial holders, takeovers, results of meetings, results, dividends, capital, other meetings.

## Coming from gloom-asx

This plugin replaces [gloom-asx](https://github.com/caelyx/gloom-asx). The `ASX` shortcut still works (as an alias of `ASXA`), and the Ticker Research tab is now called Announcements. Uninstall gloom-asx (`gloomberb remove gloom-asx`, the folder `gloomberb install caelyx/gloom-asx` created) once this is installed, so the two do not both add a tab.
