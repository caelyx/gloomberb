# News Heatmap (`gloom-newsmap`)

A [Gloomberb](https://gloom.sh) plugin that draws the news as a treemap, in the
spirit of [Newsmap](http://newsmap.jp) and [Newsola](https://www.newsola.com).

```
NMAP
```

- **Bigger** tiles are more important — a story's rank in its section's feed,
  lifted by how many outlets are carrying it.
- **More vivid** tiles are newer. The hue fades toward the pane background as a
  story ages, on a six-hour half-life. The legend carries the scale.
- **Hue** is the section. Seven exist — Top, World, National, Business, Tech,
  Showbiz, Sport — and **World, National, Business and Tech are on by default**;
  the rest are a keypress or a settings change away.

Two feeds: **Google News**, in any of sixteen regional editions, or
**Gloomberb's own** market news. The edition defaults to Australia and is
changed per pane, or for the whole plugin (and its news provider) in the plugin
settings.

## Keys

| Key | Does |
| --- | --- |
| arrows | move to the neighbouring tile |
| `j` / `k` | next / previous tile, heaviest first |
| `Enter`, `o` | open the story |
| `1`…`9` | show or hide the section with that number in the legend |
| `0` | show every section |
| `[` / `]` | previous / next edition |
| `d` | cycle density — sparse, normal, dense |
| `g` | switch between Google News and Gloomberb news |

`r` refreshes, as it does everywhere in Gloomberb; on the Gloomberb feed the
host pushes updates, so the pane leaves `r` to the app rather than swallowing
it. The board refreshes itself every 15 minutes, and only while the pane can
actually be seen.

**Density** decides how much of the pane one story gets: the same 88x16 pane
draws 7, 13 or 19 tiles. It cannot make tiles smaller than a headline needs, so
"dense" means as many headlines as stay readable rather than as many as fit.

The number keys and the **Sections** setting are different things: the setting
decides what is *fetched*, the number keys hide what is already drawn. Hidden
sections persist with the pane.

Tiles are clickable, and double-click opens. Edition, sections and feed are
also in the pane's settings dialog, and persist per pane.

## Install

```bash
gloomberb plugin link /path/to/gloom-newsmap
```

It is not published to a registry, so there is no `gloomberb install` line yet.

## From the command line

```bash
gloomberb fn NMAP                    # the board as a ranked table
gloomberb fn NMAP US                 # a different edition
gloomberb fn NMAP --sections WORLD,BUSINESS --limit 10
gloomberb fn NMAP --json | jq -r '.data.rows[].url'
gloomberb fn NMAP --refresh          # skip the cache
```

```
#  Headline                                               Source           Section   Age  Weight
─  ─────────────────────────────────────────────────────  ───────────────  ────────  ───  ──────
1  Ceasefire talks resume after overnight strikes         Reuters          World     12m    1.11
2  Major lender suspends three funds and cuts asset       Financial Times  Business   1h    1.11
3  RBA lifts rates to the highest level in fifteen years  ABC News         National  30m    1.00
```

A treemap does not survive `--json`, so this is the data behind it: the same
stories ranked by the same weight, plus the `url`, ISO `publishedAt` and
`outlets` count a script actually needs. Without it the host falls back to
screenshotting the pane and scraping the text back out, which is clipped and
fragile — `gloomberb catalog NMAP` reports `ready` rather than `rendered`
because of this.

Precedence for the edition is argument, then `--edition`, then the pane's own
setting, then the plugin default.

## What it also provides

A `news` capability, `news.google-news`, so the rest of Gloomberb can read
Google News. It reaches the **News Feed** (`N`) and **Top News** (`TOP`) panes
and the `gloomberb news` command, and `gloomberb provider status` lists it
alongside the built-in sources.

It declines what it cannot honestly answer: ticker and sector feeds go to the
providers that can search by symbol, and `breaking` is declined outright
because RSS carries no signal for it.

**It serves Business and Tech, not the four sections the pane draws.** A beach
closure is a fair tile in the heatmap — it is what is happening today — and
noise in a feed sitting between a Fed story and an earnings call. The plugin
setting **News provider scope** widens it to everything the pane shows. A query
that names its own topics always gets them, whatever the scope.

It shares one cache with the pane, keyed per section, so the sections the two
have in common are fetched once between them. That matters more than it sounds:
the host's aggregator polls every tracked query every two minutes and fans out
to every source, so an uncached provider would fetch four RSS feeds a minute
for as long as the app was open — and Google answers that with 503s.

## Development

Plugins are loaded by Gloomberb's embedded Bun, so no separate toolchain is
needed to run one — but typechecking and the preview script need the host
linked in, which is what the official plugins' CI does:

```bash
git clone --depth 1 https://github.com/gloom-sh/gloomberb.git ../.gloomberb-host
bun install --cwd ../.gloomberb-host
mkdir -p node_modules
ln -sfn "$PWD/../.gloomberb-host" node_modules/gloomberb
ln -sfn "$PWD/../.gloomberb-host/node_modules/react" node_modules/react
```

Then:

```bash
bun test                        # model.test.ts and parse.test.ts need no host;
                                # text.test.ts and pane.test.tsx need the link
bun x tsc --noEmit              # needs the host link
gloomberb plugin link "$PWD"
gloomberb plugin doctor gloom-newsmap
```

Two things about the OpenTUI test harness, both of which cost an afternoon:
`testRender` calls `act` itself, so wrapping it in another `act` deadlocks the
first render of the process; and `captureCharFrame()` on a renderer that has
not painted yet segfaults Bun. Settle first, then capture.

`dev/preview.ts` renders a map straight to stdout as truecolor ANSI — the same
layout, colours, wrapping and legend the pane draws, without starting the TUI.
It measures text with the host's own `displayWidth`, as the pane does; an
earlier version did not, and that difference hid a bug that was deleting a
third of every Japanese headline.

```bash
bun dev/preview.ts AU 118 30       # edition, width, height, [density]
bun dev/preview.ts demo 118 30     # offline fixture, no network
bun dev/preview.ts demo-jp 70 14   # the CJK wrapping case
bun dev/preview.ts demo 88 16 dense
```

Use the fixture while iterating on geometry. Google rate-limits a repeatedly
refetched feed with 503s, and the preview will tell you so.

## Layout

| File | |
| --- | --- |
| `index.tsx` | the plugin object: pane, template, settings, capability |
| `pane.tsx` | the pane — tiles, legend, keys, footer |
| `model.ts` | the encoding: weight, age, colour, contrast, wrapping, dedupe, tile budget. No host imports, so it is unit-testable |
| `cache.ts` | one cache in front of Google News, shared by the pane and the capability |
| `config.ts` | the plugin-scoped edition the capability serves |
| `parse.ts` | Google News feed URLs and RSS parsing. Also host-free |
| `google-news.ts` | fetching, over the host's `httpFetch` |
| `gloom-news.ts` | adapter for the host's own news feed |
| `capability.ts` | the `google-news` news provider |
| `headless.ts` | the table behind the map, for `gloomberb fn NMAP` |

Tile geometry comes from Gloomberb's own squarified treemap
(`buildMetricTreemapNavigationTiles`, `findMetricTreemapNeighbor`); the tiles
are drawn here rather than by `MetricTreemapSurface`, which colours by price
change and cannot express a section hue.

## Licence

MIT

## A note on the text pipeline

`wrapToWidth` breaks lines on a *measured prefix* and never on the host's
`truncateToDisplayWidth`. That function appends an ellipsis, so it is not a
prefix of its input, and advancing a cursor by its length skips characters that
were never drawn. Doing that cost about a third of every CJK headline and put a
false `...` on every wrapped line. `text.test.ts` guards the boundary, including
an assertion about the host's behaviour so the reasoning breaks loudly if it
ever changes.
