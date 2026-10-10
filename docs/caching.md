# Caching

Most panes open with the data they last showed, then refresh behind it. The plugin keeps each source's last good answer in Gloomberb's plugin cache (`createPluginCache`, stored in the app's local database), so a restart does not mean waiting on the RBA, ABS or ASIC again.

## What you see

- A pane with a cached copy draws it at once. The footer says how old it is (`updated 3h ago`, from when the source last answered) and shows the loading mark while the refresh runs.
- A copy still inside its freshness window (below) is not fetched again, also when the auto-refresh timer fires; only `r` refreshes regardless, except OpenElectricity's, whose requests cost credits: `r` and the timer ask it again only once its copy is past its freshness window.
- Switching a pane's window or filter (`AUTN`, the Short positions tab, `ASXA`'s price-sensitive filter) draws that window's copy at once, when there is one.
- If a refresh fails, the pane keeps the copy, the footer adds `stale`, and the amber `⚠` says what failed. Terminal reports (`gloomberb fn …`) add the same as a note. A failed `r` on a copy still inside its window is reported once; the next ordinary load shows the copy as current again.
- A FRANK% or GROSS YLD cell whose refresh failed keeps its last value and waits half an hour before asking again.
- A copy past its expiry is never shown: the pane waits for the source, or shows the error.

## Policy

All in one table, `CACHE_POLICY` in `shared/cache-policy.ts`.

| Source | Kept | Fresh for | Shown for at most | Entries |
|---|---|---|---|---|
| RBA tables F1, F2, F11.1 (`RBA`, chart series) | yes | 1 hour | 30 days | 3 |
| ASX cash rate futures strip (`RBAP`) | yes | 15 minutes | 7 days | 1 |
| ASX cash rate futures, one settled day each (`RBAP` look-backs) | yes | 400 days (a settled day never changes) | 400 days | 400 |
| ABS indicators (`ABS`, chart series) | yes | 6 hours | 120 days | 40 |
| ABS release calendar | yes | 6 hours | 14 days | 1 |
| ASIC report index (`ASXS`, Short positions tab) | yes | 1 hour | 14 days | 1 |
| ASIC daily reports | yes | a year (a published day never changes) | a year | 150 |
| AusTender contracts (`AUTN`), per window | yes | 30 minutes | 7 days | 4 |
| ASX company directory (search, supplier and short-position names, heatmap) | yes | 12 hours | 14 days | 1 |
| ASX fund list (search) | yes | 12 hours | 14 days | 1 |
| Franking per company (Franking tab, FRANK% and GROSS YLD columns) | yes | 6 hours | 30 days | 500 |
| ASX 200 membership (`HMA`) | yes | 1 day | 14 days (membership changes quarterly) | 1 |
| ASX market announcements (`ASXA`, news) | yes | 2 minutes | 1 day | 4 |
| One company's announcements, a page at a time | yes | 15 minutes | 7 days | 300 |
| Announcement PDF extracts | yes | 30 days | 90 days | 1,000 |
| NEM generation history (`NEM` Mix history tab, generation chart series): 48 h hourly, 3 months daily, 12 months weekly | yes | 3 hours (AEMO adds a trading day after it closes at 04:00 AEST) | 14 days | 3 |
| OpenElectricity rooftop solar and battery charging and discharging, last 24 hours at 5 minutes, every region (`NEM` Generation and 24h, rooftop and battery chart series; only with an API key) | yes | 10 minutes (each request costs credits, so longer than the 5-minute data; rooftop runs 1.5 hours behind anyway) | 6 hours | 1 |
| OpenElectricity history for AEMO's 48 h, 3 month and 12 month windows (`NEM` Mix history; only with an API key) | yes | 12 hours (past days; the window moves when AEMO's does) | 14 days | 6 |
| NEM prices, notices, FCAS and the current generation mix (`NEM`), NEM price and demand chart series | no: dispatch runs every five minutes, so a saved copy is wrong by the time it shows; the source answers in about a second (the 7-day price history, about 800 KB, in two or three) | | | |
| Quotes and price history (`ASXM`, `HMA` tiles, franking yields) | no: they belong to Gloomberb's own quote layer | | | |
| News feeds (ABC, RBA, ASIC, Takeovers Panel, TGA) | no: the news pane keeps its own article cache | | | |
| Options chains, ASX search | no: short-lived and per keystroke | | | |

"Fresh for" follows how often the source publishes: the RBA updates its tables each business day, the ABS releases monthly or quarterly at 11:30 am, ASIC posts one report a business day (four business days behind), AusTender publishes through the day, and index membership changes at quarterly rebalances.

## Limits and safety

- **Size.** Each kind keeps at most its entry count on disk; past it, the least recently fetched entry is deleted. Copies written before a kind was bounded leave only when they expire, and a running session keeps every copy it has loaded in memory until it quits. With every pane used the cache is about 3 MB (the RBA's three tables 1.5 MB, a month of ASIC reports 1.1 MB, the ASIC index 0.4 MB, the three NEM generation windows 0.2 MB, and with an OpenElectricity key its 24-hour and history copies about 0.4 MB). ASIC's daily reports set the ceiling: about 50 KB each, at most 150, so under 8 MB if you browse the 3M and 1Y histories. Gloomberb also caps its local cache as a whole (least recently used first).
- **Format changes.** Each kind has a schema version. When a release changes what it stores, it bumps the version and older copies are dropped rather than misread.
- **Corrupt entries.** Every entry is checked field by field when read back; one that does not match is ignored and fetched again. A damaged entry index is rebuilt.
- **Clock changes.** A copy dated more than five minutes ahead of the clock (saved under a wrong clock) counts as stale and is fetched again.
- **Shared requests.** Panes, chart series and reports asking for the same copy share one request. One of them closing (a chart removed, a report cancelled) does not cancel it for the others; it is abandoned only when every one of them has gone, and the HTTP timeout ends a request that hangs.

## Where it applies

- **Terminal and desktop app:** on disk, in the profile's local database.
- **Web:** the hosted web app does not install plugins; a web build that bundles this plugin keeps its caches for the session only.
- **`gloomberb fn`:** each report runs in a fresh process with its own in-memory cache, so it always asks the sources (Gloomberb gives plugins no disk store there).
