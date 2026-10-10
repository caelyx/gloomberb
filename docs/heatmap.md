# ASX heatmap

`HMA` (gloom-asx's code, kept) draws the ASX as a treemap: each tile is sized by market cap and coloured by the day's move. Quotes come through Gloomberb (Gloom Cloud, 15 minutes delayed for ASX).

## Boards

Pick the board in the query bar, with `1`, `2` and `3`, or in the pane settings (which, with **Top N by market cap** chosen, name the first two Top 50 and Top 200 by market cap):

- **ASX 50** (the default): the S&P/ASX 50.
- **ASX 200**: the S&P/ASX 200. Signed out, Gloom Cloud quotes at most 100 symbols per request, so this board asks in two batches, one after the other. Any name that comes back without a quote is left out and a `⚠` in the footer counts them; if Gloom Cloud's signed-out rate limit was the reason, the footer says so and the second batch is not asked for (a refused batch makes Gloomberb ask for each of its names on its own, which only deepens the limit).
- **Sectors**: the eleven S&P/ASX 200 GICS sector indices (`^AXEJ`, `^AXFJ`, `^AXMJ` …), one tile each, sized by the market cap of the sector's ASX 200 members. If the ASX company directory cannot be loaded the sectors are sized evenly, and the footer says so.

On the ASX 50 and ASX 200 the tiles are grouped into sector blocks, each headed by the sector's market-cap-weighted move, with the industry group on each tile. Untick **Grouped** in the query bar (or **Group by sector** in the settings or the `.` menu) for one flat map, which then names each tile's sector. A board whose sectors could not be loaded is always flat, and so is a pane too small for any sector header. A pane too small for a single tile asks to be enlarged.

Tile area grows with the square root of market cap, as on Gloomberb's `HM`, so mid-caps have room beside BHP and CBA. A line that does not fit its tile is left off rather than cut short; a sector name too long for its header or tile takes a short form (Cons Disc, Cons Staples, Comm Svcs, Info Tech, Real Est).

Colour, in the terminal, runs from pale to full strength at a 3% move; a move that rounds to 0.00% is flat, and grey means no move is known yet. The selected tile keeps its colour, lifted brighter. On the desktop each sector block is drawn by Gloomberb's own treemap surface, which colours tiles on its own scale: graded up to about a 30% move, so a 3% day is mid-strength, and the same neutral colour for a flat tile and one with no move yet. (Gloomberb does not yet let a plugin set those colours.)

Keys: arrows (or `h`/`l`) move between neighbouring tiles, `j`/`k` step to the next or previous tile in sector order, `[` and `]` step through the boards, Enter (or a double click) opens the selected company or index in Ticker Research, `r` fetches fresh quotes.

The board is rebuilt each minute. If a rebuild fails (every quote refused, or the scanner and the directory both down), the last board stays up for ten minutes, with `refresh failed` in the footer and its age in `updated …`; after that the pane shows the error.

## What the sizes mean

Tiles are sized by company market cap, not index weight. The S&P/ASX indices weight only the shares (or CDIs) on the ASX, adjusted for free float, while the ASX directory and TradingView give the whole company's market cap. Foreign-domiciled companies such as Newmont (NEM), ResMed (RMD) and, in a Top N board, Block (XYZ) therefore appear larger than their index weight, and they pull the cap-weighted moves (the board's, each sector header's, and `fn HMA`'s sector weights) further than they move the index. Float and CDI counts are not used.

## Constituents

The **Constituents** pane setting says where index membership comes from:

- **TradingView scanner** (default): `scanner.tradingview.com`, which tags each S&P/ASX 200 member with its indices (`ASX:XJO`, and `ASX:XFL` for the ASX 50). It needs no key but is an undocumented endpoint. Membership is kept on disk for a day, and a list up to a fortnight old stands in if the scanner then fails; the index rebalances quarterly ([caching](caching.md)). While an older list stands in, the footer gives its date, and the scanner is asked again after ten minutes rather than on every refresh.
- **Top N by market cap**: the 50 or 200 largest companies with a GICS sector in the ASX company directory. ASX publishes no market cap for a few large listings (CBA among them), so those are filled from their quotes. The filled ranking is kept for twelve hours; if some of those quotes were refused it is kept for ten minutes only, so a refusal does not keep CBA out of the Top 50 for half a day. This approximates the index but is not it, and the board says **Top 50** / **Top 200** instead of ASX 50 / ASX 200. Large foreign companies with an ASX line (Newmont, Block) can rank in.

If the scanner fails (an HTTP error such as 403, no connection, a response it cannot read, or fewer members than the index has: under 45 tagged ASX 50 or 150 ASX 200), the board falls back to the market-cap ranking by itself and the footer reads, for example, `Top 50 by market cap (TradingView unavailable)`. The scanner is tried again after ten minutes, or at once with `r`.

Sectors come from the ASX directory's GICS industry group, mapped to its sector.

## Report

`gloomberb fn HMA` prints the board (universe, where its constituents came from, up/down count, cap-weighted move), each sector's weight, cap-weighted move and best and worst names, and the five biggest gainers and losers. Options: `--universe asx50|asx200|sectors` and `--source tradingview|market-cap`. A fallback from TradingView, an older member list, or a failed refresh is listed under Notes; names without a quote are listed under errors and mark the report incomplete.
