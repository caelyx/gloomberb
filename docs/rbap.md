# RBA rate path

The `RBAP` pane (alias `WIRA`) is the Australian counterpart of Gloomberb's `WIRP`. It shows the cash rate target the market prices after each upcoming Monetary Policy Board meeting, read from ASX 30-day interbank cash rate futures, the same contracts behind ASX's RBA Rate Tracker. Open it next to `RBA`, which shows the rates as they are.

## Tabs

- **Path:** each upcoming meeting with
  - the odds of a move there (`29% hike`);
  - the move priced there, in basis points to one decimal (**Priced**): the odds times 25 bp, so `-0.3 bp` is about 1% odds of a cut. It is what the market prices, not a forecast that the RBA will move by a fraction; the RBA moves in whole steps, in practice 25 bp;
  - the implied cash rate target after it;
  - the change from today, in basis points and in 25 bp moves.

  Meetings run as far as the strip does. A date marked `~` is estimated, because the RBA has not yet published that year's schedule (see [Estimated meetings](#estimated-meetings)).

  The chart above the table steps through the implied path, with today's target as a reference line and the path as priced 1 week, 1 month and 1 year ago where those exist (see [Look-backs](#look-backs)). Left and Right step along the meetings.
- **Contracts:** every listed contract with
  - the average cash rate it implies for its month (100 less the price);
  - its settlement, last trade, bid, ask and the day's volume.

  A last trade from before the settlement day is dimmed (one during the next session is not): most of the strip trades rarely, and its settlement is ASX's daily mark, not a trade.

The figures at the top give the next meeting's odds, the cash rate target, the overnight cash rate (and its gap to the target) and how far the path moves by its last meeting. `o` opens ASX's RBA Rate Tracker; `r` reloads. `gloomberb fn RBAP` prints the summary, the path and the contracts (`--json`, `--csv`).

## Method

These are facts about the contracts, then the assumptions the pane makes.

**Facts.**
- Each contract settles at 100 less the average of the RBA's interbank overnight cash rate over its calendar month. So `100 − price` is the average rate the market expects for that month.
- The board's decision is announced at 2:30 pm Sydney time and takes effect the next day.

**Unwinding the path.** The pane works through the meetings in order, starting from today's overnight cash rate (RBA table F1). For each meeting it finds the rate after the decision (`post`) in one of three ways:

1. **New rate starts on the 1st:** `post` is that month's average.
2. **The next month has no meeting:** `post` is the next month's average. With the 2026–27 schedule about half the meetings qualify.
3. **Otherwise:** it splits the month the decision takes effect in by calendar days:

   `post = (average × D − pre × d_before) / d_after`

   where `D` is the days in the month, `d_before` the days before the new rate applies and `d_after` the rest.

`pre` is the rate before the meeting: today's rate for the first meeting, then the previous meeting's `post`.

Option 3 is ASX's own formula. The pane prefers options 1 and 2 because the split magnifies a contract's noise by `D / d_after`, by up to 31 times for a meeting at the end of a month. `fn RBAP` reports which method each meeting used.

**Odds.** These are two-outcome conditional odds, as in WIRP: a move of +0.07 percentage points reads as 0.07 / 0.25, about 29% odds of a 25 bp hike. The same figure in basis points is the **Priced** column: +7.2 bp beside 29% hike. Above 100%, more than one move is priced at that meeting. This is not a full distribution of outcomes.

**Overnight rate against the target.** The contracts settle on the overnight cash rate, which can sit a few basis points off the target. The pane takes the gap from F1 and subtracts it, so the path is on the target's basis; ASX's calculation does the same.

The gap is measured on the overnight rate's own date, because F1 can publish the target a day ahead of it. On the day a new target applies, the two latest figures would otherwise differ by the decision itself. The path starts from the latest target plus that gap.

**Check against ASX.** For the 8 October 2026 settlement, the November contract at 95.34 gives 4.67% after the 3 November meeting. That is 27% odds of a hike, the same as ASX's Rate Tracker published that day.

## Limits

- **Settlement prices only.** The path is as at the last settlement, once each business day. It does not use intraday trades or quotes.
- **Undocumented source.** The strip comes from the JSON behind asx.com.au's futures pages, which ASX does not document and may change.
- **Meeting dates are a snapshot.** Published dates come from the RBA's schedule (2026 and 2027), shared with the `RBA` pane. Later meetings are estimated (below).
- **The last meetings are the least certain.** A meeting late in the last listed month can only be split from that month (there is no following contract), so its noise is magnified. The ~21 March 2028 meeting leaves 10 of 31 days, about three times.
- **F1 behind a decision.** The path starts from F1's latest target, and meetings count from the day F1 is as at, not from today. So a decision F1 does not show yet (the day it takes effect, or while the RBA's site is down and an older copy is shown) stays on its own meeting, with a notice that it is shown as priced, not as decided.
- **Gaps in the strip.** If a contract the path needs is missing, the path stops at the meeting before it.
- **Without table F1** the path starts from the front contract's average, with no target adjustment, and a notice says so. If a meeting takes effect inside the front month, that average mixes the rates before and after it, so nothing anchors the path: the pane then prices no path (rather than a false 0% at that meeting) and still lists the contracts.

## Estimated meetings

The RBA publishes its board schedule about a year ahead; on 10 October 2026 it had published 2026 and 2027. So that the pane shows everything the strip prices, it estimates later meetings. Each is a meeting in the last published year moved on 364 days (52 weeks): the same weekday, since the board decides on Tuesdays, and about the same week of the month. 9 February 2027 becomes ~8 February 2028, and 23 March 2027 becomes ~21 March 2028.

Estimated dates are marked `~` in the pane, the chart labels and `fn RBAP`, with a footnote. They are priced the same way as published ones. An estimated date can also decide how a neighbouring month is read (whole or split), so a wrong estimate moves the meeting before it too. When the RBA publishes a year, add its dates to `RBA_DECISION_DATES` (`rba/model.ts`) and the estimates for that year go.

## Look-backs

ASX publishes no history for the strip, so the pane builds its own. Each time it loads, it keeps that settlement day's prices on disk, one copy per day for up to 400 days. A look-back appears once a copy exists within three days of 1 week, 1 month or 1 year before the latest settlement.

Each look-back is priced from its own day's cash rate, so a meeting held since then still links it to today's meetings. It then shows only the meetings still to come.

The copies build only on days the pane loads in the app. `gloomberb fn` keeps nothing on disk, so `fn RBAP` shows no look-backs.

ASX's own one- and five-day change fields are not used. They are measured from each contract's last trade, which for most of the strip is days or weeks old.

## Caching

The strip is kept on disk and checked again after 15 minutes. The daily copies are described above. See [caching](caching.md).

## Source

ASX 30-day interbank cash rate futures (`asx.api.markitdigital.com`, the JSON behind asx.com.au; unofficial and may change), and RBA table F1 (CC BY 4.0) for the cash rate and target. ASX: free for private and personal use.
