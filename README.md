# gloom-acgb

The Australian Government bond (ACGB) yield curve for
[Gloomberb](https://github.com/gloom-sh/gloomberb), from the Reserve Bank of
Australia. `ACGB` in the command bar opens the **Australian Government Bonds
Curve** pane: the curve by maturity, its week and month look-backs drawn as
ghosts, each tenor's 1D, 1W and 1M change, and the 2s10s spread. **vs UST**
in the query bar adds the US Treasury curve, for the spread between the two.

## Install

Until the plugin is published, link a checkout:

```sh
gloomberb plugin link ./gloom-acgb
```

Requires Gloomberb 0.15.4 or later. Targets: terminal (`cli`, `tui`), desktop
and web. On the web the files are fetched through Gloomberb's proxy, which
covers `www.rba.gov.au` and `home.treasury.gov` once the plugin is in the web
build.

## Use

| Key | Action |
|-----|--------|
| `r` | Refresh past the cache (Gloomberb's usual refresh key) |
| Left / Right, Up / Down, mouse | Move between tenors, on the chart and in the table |
| **vs UST** (click) | Show the US Treasury curve beside the ACGB curve |

## Against the US curve

With **vs UST** on, the US Treasury par curve is drawn as points at its
tenors (the chart has no dashed line style), in place of the week and month
look-backs. The readout under the chart gives the ACGB yield minus the US
yield at the selected tenor, and the table shows the US yield and that spread
in place of the 1W and 1M changes. Tenors the US curve does not have (4Y, 15Y,
25Y) show `--`.

The US curve is the one for the ACGB curve's own session, not today's: the
ACGB curve is days old, and a spread compares one day. When the US has no
session that day (a US holiday), the last US session before it is used, up to
ten days back, and the query bar says which. The setting is kept per pane.

## Where the data comes from

RBA statistical table F16, *Indicative Mid Rates of Selected Australian
Government Securities* (`https://www.rba.gov.au/statistics/tables/csv/f16-data.csv`):
the closing mid yield of every Treasury Bond line, daily from May 2013.
Treasury Indexed Bonds, which quote real yields, are left out.

**It is weekly.** The RBA publishes F16 on Fridays with yields up to two
business days earlier, so the curve shown is between two and nine days old.
The pane's footer gives the session it shows. Other `GC` curves are same-day or
next-day; this one is not.

The pane reads standard tenors (1Y to 30Y) off the bond lines by linear
interpolation in time to maturity. A tenor that no line on either side
brackets is left out rather than extrapolated, so 30Y appears only once a line
longer than 30 years is quoted (the longest in October 2026 matures in
June 2054), and 5s30s with it. Lines with less than three months to run are
left out: in its final days a line's quote stops tracking the curve. Since
the RBA's current method began in 2024, the 2Y, 3Y, 5Y and 10Y yields have
been within 2bp of the RBA's own interpolated table F2 on every session.

The latest curve and its look-backs are cached in plugin persistence for six
hours (stale) and 30 days (usable offline). One request fetches the whole
file, about 850 KB.

Source: Reserve Bank of Australia, licensed under
[CC BY 4.0](https://www.rba.gov.au/copyright/).

The US curve is the US Treasury's daily par yield curve, one CSV per year
(about 15 KB) from `home.treasury.gov`, the same publisher as Gloomberb's own
`GC` UST curve. It is cached per ACGB session for the same six hours and 30
days.

## Development

```sh
bun install
bun run typecheck
bun test
bun run probe   # the live curve beside the RBA's F2 yields
gloomberb plugin doctor gloom-acgb
```
