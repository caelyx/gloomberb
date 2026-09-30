# gloom-asx

ASX company announcements for [Gloomberb](https://github.com/gloom-sh/gloomberb).
Select an ASX-listed ticker (`CBA.AX`, `CBA:ASX`) and the **ASX** tab in Ticker
Research lists its announcements newest first, marks price-sensitive ones with
`$` as the ASX does, shows an extract of the announcement PDF when you open a
row, and opens the PDF or the ASX page in your browser.

**Status: verified against the live service on 29 September 2026.** Entity
lookup, the announcements list and its paging, the PDF download (no token
needed) and the PDF extract were all checked against the live Markit Digital
hosts behind asx.com.au, and the parser's tests run on real captures. Terminal UI only;
the desktop build has not been exercised, and the web build has been compiled
and its PDF extraction run in a browser, but not inside the hosted app.
`docs/live-testing.md` is the
checklist to repeat if the service changes.

## Install

```sh
gloomberb install caelyx/gloom-asx
```

Requires Gloomberb 0.15 or later. Targets: terminal (`cli`, `tui`) and
desktop. The plugin also declares `web`, so the hosted web app can compile it
into its build; the web app does not install plugins, so it runs there only
once Gloomberb lists it in `WEB_BUNDLED_PLUGIN_PACKAGES` and regenerates its
proxy allowlist to include the two Markit Digital hosts.

### Known limitations

The extract is an extra, not a requirement. When a PDF cannot be downloaded or
read (too large for the web app's proxy, which refuses bodies over about
5 MiB; refused, missing, encrypted or damaged; or the download failed), the
row says the inline extract is unavailable and `o` still opens the original
PDF. In Gloomberb 0.15.2 the desktop and web proxies carry response bodies as
text, which damages binary PDFs, so on those renderers expect that message
rather than an extract until Gloomberb carries binary bodies intact. The
terminal is unaffected.

## Use

| Key | Action |
|-----|--------|
| `Enter` | Open the row: loads the first two pages of the PDF and shows a text extract |
| `o` | Open the announcement PDF in the system browser |
| `w` | Open the ticker's announcements page on asx.com.au |
| `s` | Toggle price-sensitive announcements only |
| `r` | Refresh (bypasses the cache) |

Typing `ASX` in the command bar opens the same view as a floating pane bound
to the ticker you are on; `ASX BHP.AX` opens it for another ticker. Include
the `.AX`: Gloomberb resolves a bare `ASX BHP` to BHP's US listing.

## Configuration

`accessToken` (optional): a Markit Digital access token appended to PDF URLs.
Not needed as of 29 September 2026: PDFs download without it. Leave it empty
unless PDF downloads start failing with 401 or 403; the live-testing document
explains where the site-wide token can be found.

## Where the data comes from

The announcements pages on asx.com.au are rendered from a JSON API at
`asx.api.markitdigital.com`, and the PDFs come from
`cdn-api.markitdigital.com`. ASX offers no free API or RSS feed of its own;
its official feed, ComNews, is a paid vendor product. The research behind that
choice, including the ASX terms-of-use position, is in
`docs/research/01-asx-announcement-data-sources.md`.

The plugin behaves like one person with a browser tab open:

- one request per ticker when the tab opens (two the first time, to look up
  its entity id), then pages of 50 on scroll, and a refresh of the first page
  on Gloomberb's refresh interval while the pane is visible and its cache is
  stale;
- results cached in plugin persistence for 15 minutes (stale) and 7 days
  (usable offline); the ticker-to-entity lookup is cached indefinitely;
- PDFs fetched only for the row you open, extracts cached for 30 days;
- at most 20 requests a minute, exponential backoff on 429 and 5xx;
- an honest `User-Agent` naming this repository.

This is a personal hobby project. The owner has reviewed the ASX terms of
use and is comfortable with this pattern of access for personal use; the
reasoning is in the research note. Anyone redistributing the plugin should
form their own view.

## Development

```sh
bun install
bun test             # unit tests, offline; parser fixtures are live captures,
                     # and one compiles the entry for the browser to keep node:* out
bun run typecheck    # against gloomberb 0.15.2
bun run probe CBA    # two live requests; see docs/live-testing.md before running
```

Layout:

```
index.ts                 plugin entry (default export)
gloom.json               manifest: hosts, panes, ASX shortcut
src/plugin.tsx           registers the tab, the pane and the pane template
src/ui/                  pane component and its pure view-model
src/asx/urls.ts          the endpoints, in one place
src/asx/parse.ts         defensive JSON to model mapping
src/asx/client.ts        throttled HTTP client with the identifying User-Agent
src/asx/cache.ts         plugin-persistence caches and their TTLs
src/asx/service.ts       cache-first loading of pages and PDF extracts
src/asx/summary.ts       announcement classification, PDF text cleaning, Sydney times
src/asx/pdf-text.ts      pdf.js (unpdf) text extraction of the first pages
src/asx/extract-error.ts why an extract is unavailable, in words fit to show
scripts/probe-live.ts    the live probe
docs/                    research note, live-testing checklist and prompt
```

Tests are written first (red, green, refactor) with `bun test`.
