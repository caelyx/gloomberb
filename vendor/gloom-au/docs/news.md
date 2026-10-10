# Australian news

The plugin adds Australian sources to Gloomberb's general news feeds (`N` News Feed and `TOP` Top News, and `gloomberb news`):

| Source | What | Weight |
|---|---|---|
| ABC News | ABC business headlines (headline and link) | ordinary |
| RBA | Reserve Bank media releases, including monetary policy decisions | high |
| ASX | Price-sensitive announcements from the 300 largest ASX companies by market cap, headed with the ASX code | medium |
| Takeovers Panel | Applications, interim orders and decisions, linked to the target's ASX code where the name matches | medium-high |
| TGA | Therapeutic Goods Administration news and safety alerts (relevant to ASX healthcare companies) | low |
| ASIC | ASIC media releases (enforcement outcomes, bans, policy and market notices) with ASIC's summary; the pane's filter finds a release by its number (such as 26-237MR) | medium |

They join Gloomberb's own feed by time, limited to the last 30 days. Filtering the feed by topic, sector or sentiment leaves them out, because these sources are not tagged that way. Each source is given 8 seconds per refresh so a slow host never holds up the rest of the feed.

Ticker news for an ASX company still comes from Gloomberb's own news service; the company's complete announcement list is in Ticker Research → Announcements, and the market-wide list in `ASXA`.

ABC content is used as headline and link only, under ABC's terms. RBA releases are CC BY 4.0; Takeovers Panel and TGA items are Commonwealth material, linked to their source. ASIC media releases are CC BY 4.0 (© Australian Securities & Investments Commission); ASIC has no RSS feed, so the plugin reads the list its newsroom page is built from (the latest 20 releases), with times in Sydney time. Only links to ASIC's own site (`https://www.asic.gov.au`, `https://download.asic.gov.au`) are kept; an item pointing anywhere else is skipped. They are not linked to ASX codes: the people and firms named are rarely listed companies. ASX announcements are for personal use (see the README).
