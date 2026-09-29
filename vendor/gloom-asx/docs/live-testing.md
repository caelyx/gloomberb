# Live testing against ASX and Markit Digital

This plugin was first written in an environment that could not reach
`asx.api.markitdigital.com`, `cdn-api.markitdigital.com` or `www.asx.com.au`,
so its endpoints and field names were assumptions. The first live pass ran on
29 September 2026: the fixtures under `test/fixtures/` are now real captures,
and sections 2.1 and 6 of `docs/research/01-asx-announcement-data-sources.md`
record what it found. Keep this checklist for re-verifying after the service
changes; `docs/live-testing-prompt.md` is the prompt to give that session.

## Ground rules for the session

1. **Budget: at most 10 live requests in total** unless a person says
   otherwise. The probe makes 2 by default, 3 with `--pdf`, 4 with `--alt-url`.
2. **Never loop or poll.** Run the probe, read the report, change code, run it
   again. Do not write scripts that retry in a loop or fetch many tickers.
3. **Keep the identifying User-Agent** (`gloom-asx/<version> (+repo url)`). If
   the service rejects it, record that as a finding; do not switch to a
   browser User-Agent without a person deciding to.
4. **Count Gloomberb's requests too, and close it when you are done.** A
   visible ASX pane refreshes page 0 on Gloomberb's refresh interval (30
   minutes in the first pass's config) once its 15-minute cache is stale, and every pane you
   open or row you press Enter on is a request. The first pass counted them
   with a temporary logging transport in `src/plugin.tsx`; remove it before
   committing.
5. **Do not fetch the whole-market endpoint** (`entityXids=[]` with no id) and
   do not raise `itemsPerPage` above 50.

## Setup

```sh
git clone https://github.com/caelyx/gloom-asx.git
cd gloom-asx
bun install
bun test            # 83 tests; the parser fixtures are live captures from 29 Sep 2026
bun run typecheck   # against gloomberb 0.15.2 from npm
```

## Step 1: the two-request probe

```sh
bun run probe CBA
```

The probe drives the production `AsxClient` through a recording transport,
saves each raw response under `docs/research/samples/`, and prints a report of
checks `L1` to `L13`. Each check maps to an assumption in the code:

| Check | Assumption | Where to fix if it fails |
|-------|------------|--------------------------|
| L1 | `search/predictive?searchText=CODE` exists and resolves a code | `predictiveSearchUrl` in `src/asx/urls.ts` |
| L2 | Its JSON is `{ data: { items: [...] } }` | `itemsOf` in `src/asx/parse.ts` |
| L3 | Items carry `xidEntity` and `symbol` | `parsePredictiveSearch` in `src/asx/parse.ts` |
| L4 | `markets/announcements?entityXids[]=XID&page=N&itemsPerPage=M` exists and returns `{ data: { items } }` | `announcementsUrl` in `src/asx/urls.ts`; run with `--alt-url` to try the JSON-array form |
| L5 | (information) the real field names of an item | compare with `parseAnnouncement` in `src/asx/parse.ts` |
| L6 | The parser keeps the items (each has `documentKey` and `headline`) | `parseAnnouncement` |
| L7 | `date`, `symbol`, `companyInfo[0].displayName`, `announcementTypes`, page count and size map | `parseAnnouncement`; add the real key names to the fallback lists |
| L8 | (information) the PDF URL the parser produced | `pdfUrl` in `src/asx/urls.ts` |
| L9 | Dates parse so that sorting newest-first works | `isoDate` in `src/asx/parse.ts` |
| L10 | (information) the price-sensitive flag is being read | `parseAnnouncement`, the `sensitive` line |
| L11 | The PDF downloads from `cdn-api.markitdigital.com/.../file/{documentKey}` without a token | `pdfUrl`; if it needs a token see below |
| L12 | pdf.js under Bun extracts text and the watermark is removed | `src/asx/pdf-text.ts`, `cleanPdfText` in `src/asx/summary.ts` |
| L13 | (information) whether `entityXids=[XID]` also works | note it in `urls.ts` |

Also record from the printed response headers: any `x-ratelimit-*`,
`retry-after`, `cache-control` or CDN headers. Put them in the research note,
section 2.1.

## Step 2: the PDF and the extract

```sh
bun run probe CBA --pdf
```

If L11 fails with 401 or 403, the file gateway wants the site-wide token the
ASX front end embeds. Find the current value by opening any announcement from
`https://www.asx.com.au/markets/trade-our-cash-market/announcements.cba` in a
browser and reading the `access_token` query parameter of the PDF URL it
navigates to. Then:

```sh
bun run probe CBA --pdf --token <that value>
```

If that works, decide with the user whether to ship the token as a default in
`src/asx/urls.ts` (it is public, but it is still someone else's key) or leave
it as the optional `accessToken` plugin setting it already is. Update the
research note either way.

If L12 extracts no text from a real PDF, look at the raw text the probe
printed. The likely causes are: text runs glued without spaces (adjust the
`hasEOL` handling in `pdf-text.ts`), the watermark rendered as separate
letters (extend `WATERMARK` in `summary.ts`), or a scanned image (nothing to
do; the pane already explains that).

## Step 3: turn the captures into fixtures

Once L1 to L9 pass:

1. Copy `docs/research/samples/CBA-predictive.json` to
   `test/fixtures/predictive-cba.json` and
   `docs/research/samples/CBA-announcements-page0.json` to
   `test/fixtures/announcements-cba-page0.json`.
2. Update the expected values in `src/asx/parse.test.ts` to the real
   document keys, headlines and dates. Keep the tests that exercise fallbacks
   and garbage input.
3. Update `test/fixtures/README.md` to say the captures are real and when
   they were taken.
4. `bun test` and `bun run typecheck` must both pass.

## Step 4: run it inside Gloomberb

```sh
gloomberb plugin link /absolute/path/to/gloom-asx   # or, once published: gloomberb install caelyx/gloom-asx
gloomberb
```

Then check, with one ASX ticker such as `CBA.AX` selected:

- The Ticker Research pane shows an **ASX** tab; it is absent for a US ticker.
- The tab lists announcements newest first, price-sensitive ones prefixed `$`,
  rows lodged by another issuer led by its code (`CAR · …`), the type label in
  the Type column, and the company, count and
  price-sensitive figures in the header grid.
- Moving the cursor shows the metadata lines; pressing Enter on a row shows
  "Loading the announcement PDF…" and then the extract with its page note.
- `o` opens the PDF in the system browser, `w` opens the ASX announcements
  page, `s` toggles price-sensitive only, `r` refreshes.
- Scrolling to the bottom loads the next page when `hasMore` was true.
- Typing `ASX` in the command bar opens the floating pane bound to the current
  ticker, and `ASX BHP.AX` opens it for another; running it again for the same
  ticker focuses the existing pane. A bare `ASX BHP` resolves to BHP's US
  listing in Gloomberb, and the pane then says to use `ASX BHP.AX`.
- Switch to a second ASX ticker and back: the first one comes from cache (no
  new request; count them as in ground rule 4).
- Restart Gloomberb: the list appears immediately from the persisted cache;
  if the cache is more than 15 minutes old, the footer shows "showing cached
  data" until the refresh lands.

The desktop app renders panes in a browser view, and its requests go through
the Bun process in a JSON envelope that carries the body as text. In
Gloomberb 0.15.2 that damages binary PDFs, so there (and on the web, whose
worker proxy does the same) the extract is expected to read "Inline extract
unavailable for this document" while `o` still opens the PDF. `unpdf` itself
runs in a browser: its default build inlines the pdf.js worker.
In Gloomberb 0.15.2, `gloomberb fn` and `gloomberb shot` failed with a missing
`src/renderers/electrobun/view` directory, so the desktop build has not yet
been exercised.

## Step 5: record what was learnt

- Update `docs/research/01-asx-announcement-data-sources.md`: section 2.1
  with the real response shape and headers, section 6 to list what is now
  verified. Section 4 (terms of use) is settled; the owner has reviewed the
  terms and accepted them for personal use.
- Update the README status line.
- Commit on a branch and open a pull request; do not push to `main`.

## Known unknowns, and what the 29 September 2026 pass found

- Whether `entityXids[]` needs literal brackets, URL-encoded brackets, or the
  JSON-array form: both literal `[]` and the JSON-array form work.
- The exact item field names and whether a total count is returned: resolved.
  `count` is the entity's total; the full field list is in research section 2.1.
- Whether the bare PDF URL works without `access_token`: it does.
- Whether the service objects to a non-browser User-Agent: it does not.
- Whether `announcements.asx.com.au/asxpdf/...` URLs appear in the JSON: they
  do not (`url` is empty). Whether ASX shows a terms interstitial before them
  in a browser is still unknown.
- Whether the search endpoint returns ETFs and hybrids under their own codes:
  still unknown. Hybrids' announcements come back under the parent's `symbol`.
