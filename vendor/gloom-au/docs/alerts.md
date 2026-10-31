# ASX alerts (AULRT)

Alerts on ASX company announcements and coming dividend dates, for one company, every ASX holding in your portfolios and watchlists, or the whole market. Checks run in the background while Gloomberb is open, an hour apart by default. AULRT is for situational awareness, not trading: an alert can arrive up to one interval after the announcement.

## Where it shows

- **`AULRT`** opens the pane. **Alerts** (`1`) lists what has fired, newest first: when, code (and company, in a wide pane), event and headline. Enter opens the company in Ticker Research on its Announcements tab (Franking for a dividend date); `o` opens the announcement's PDF; `c` clears the list (the rules stay). The last 500 alerts are kept. **Rules** (`2`) lists what is watched; `p` pauses or resumes a rule, `d` deletes it. `[` and `]` switch between the views.
- **`R`** checks now. **`a`** adds a rule, as do **Add ASX Alert** in the command bar and **`AUSA <code>`** (`AUSA BHP`), which fill in the company: the code typed, else the active ticker when it is an ASX listing. After saving, a code ASX's search does not know brings a warning. **`i`** steps the check interval through 15 and 30 minutes and 1, 2 and 4 hours. The interval is also in the plugin's settings.
- The footer shows when ASX was last checked, when the next check is due, and the interval. A failed check shows its reason there rather than as a notification.
- A new alert comes as a notification naming the company (from the ASX company directory), or as a desktop notification while Gloomberb is in the background. Up to three alerts from one check notify one by one; more come as one summary that opens AULRT.

## What a rule watches

| Watch for | Fires on (ASX's own announcement type labels) |
|---|---|
| Results and earnings | Results: Appendix 4D/4E, half-year and full-year accounts, annual reports, preliminary final reports. Quarterly: quarterly activities and cash flow reports (Appendix 4C). Guidance: profit guidance and trading updates. Results date: a company's notice of its results or reporting date. |
| Dividend announcements | Any dividend type: rate, record date, pay date, special, DRP, other. Warrant issuers' "Structured Products Distribution" notices are left out. |
| Trading halts | Trading halts, halts lifted, suspensions from quotation and reinstatements. |
| Any announcement | Everything matching the rule's other filters. |
| Dividend dates | The ex-date, record date and/or pay date of each company's latest declared dividend, from the chosen number of days ahead (0 to 14, default 1) until the day itself. Each date alerts once per rule. |

Each announcement carries ASX type labels, set when it is lodged, and AULRT matches on them. It does not use ASXA's headline categories, which are broader on purpose: an earnings alert on any headline containing "results" would also fire on drilling results. Only an item with no type labels is judged by its headline, and then narrowly.

From: **One company** (an ASX code), **Portfolios and watchlists** (every ASX listing in any of them, read at each check), or **Whole market**. Announcement rules (not dividend dates) can also be limited to **price-sensitive** announcements and to headlines containing a **keyword**. Across the whole market, every announcement, every results announcement and every dividend announcement are refused as too broad (hundreds a day in reporting season, which would also push other alerts out of the list); add a keyword or limit them to price-sensitive ones. Trading halts, about ten a day with their lifts, are allowed. Dividend dates cannot follow the whole market, because they are looked up company by company.

A new rule fires only on announcements released after it was made. A paused rule fires on nothing released while it was paused.

## How hard it works ASX

- A one-minute timer only compares clocks; ASX is asked only when the interval has passed since the last check. That time is saved, so restarting Gloomberb does not check early.
- Announcements: one request reads the latest 500 items across the market (about 12 hours of a quiet October trading day). A check reads further pages only until it reaches the previous check, at most 8 (4,000 items), and reads 30 minutes back past the previous check so a late-arriving item is not missed. After a long time closed, the oldest announcements beyond those 8 pages are not checked, and the pane says so.
- Dividend dates: one request per company for its latest dividend, at most once a day; sooner only when the announcement feed shows a new dividend announcement for that company. The copy is shared with the Franking tab and columns.
- Company names for notifications come from the ASX company directory, already cached for search (refreshed twice a day).
- With no active rule, nothing is requested.

## Limits

- **Only while Gloomberb is open.** Nothing is checked while it is closed. On reopening, the first check catches up as described above. Gloomberb's own `ALRT` event alerts are checked by Gloom Cloud, which can email; a plugin cannot use that.
- **Not part of `ALRT`.** Gloomberb gives plugins no way to add alert sources to `ALRT`: its event rules accept a fixed list of kinds, and its earnings and filing alerts accept US listings only. AULRT is a separate pane for that reason.
- **Upcoming earnings dates** are known only when a company lodges a notice of its results date ("Results date" above). ASX publishes no reporting calendar, and Gloomberb's earnings calendar gives the last ASX report date, not the next one.
- **Dividend dates** cover each company's latest declared dividend only, as ASX's company statistics give it.
- An announcement belongs to the company that lodged it. A notice lodged by another issuer about a company (a substantial holder notice, for example) is matched to the lodging issuer only.
- The announcement feed is the same unofficial asx.com.au data ASXA uses, and may change without notice.

## Source

ASX's market announcement feed (`asx.api.markitdigital.com/asx-research/1.0/markets/announcements`, the data behind asx.com.au) and its company key statistics for dividends. ASX: free for private and personal use; commercial use needs ASX's written authority.
