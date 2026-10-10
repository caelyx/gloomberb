# Private web deployment

This fork adds a small set of changes so the browser build can run as a private
deployment behind Cloudflare Access, with extra bundled plugins, and without
requiring a Gloom Cloud sign-in to open the workspace or use public-data
plugins. Gloom Cloud itself is not modified or self-hosted: `/api/*` still goes
to `https://api.gloom.sh`, and Gloom's own authentication rules still apply to it.

Baseline: upstream `gloom-sh/gloomberb` at `e21757bcfbcede7841f7bbd13d0526374b87379c`
("Lay the groundwork for splitting the big built-in plugins (Linear: GLO-340)
(#1528)", 10 October 2026), merged into this branch. Originally written against
`62317c477c1ef9b8394a12eac971c5546441b76e` (29 September 2026).

## Two separate kinds of authentication

| | Cloudflare Access | Gloom Cloud session |
|---|---|---|
| Proves | the person may use **this deployment** | the person has a **Gloom account** |
| Enforced by | Cloudflare, in front of the Worker | `api.gloom.sh` |
| Required for | everything on the hostname | Gloom Cloud features only (sync, Cloud market data and news, AI, etc.) |
| Credential | `CF_Authorization` cookie / `Cf-Access-Jwt-Assertion` header | `gloomberb.session_token` cookie |
| Forwarded to | nobody (stripped from `/api/*` and `/http-proxy` traffic) | `api.gloom.sh` only (never to plugin hosts) |

Request flow:

```
browser ──(Access login)──▶ Cloudflare Access ──▶ Worker (main)       
                                                  ├─ static assets (dist/web)
                                                  ├─ /api/*        ──▶ api.gloom.sh   (Gloom session cookie passed through;
                                                  │                                    Access credentials stripped)
                                                  └─ /http-proxy   ──▶ allowlisted plugin host only
                                                                       (no Gloom session required in private mode;
                                                                        Gloom and Access credentials stripped;
                                                                        every redirect hop re-checked)
```

Anonymous (no Gloom session): the workspace opens, public-data plugins work,
and Cloud-backed panes show their normal sign-in state. Signing in through the
app's existing "Log in" flow enables Cloud features; signing out returns to the
anonymous state without closing the workspace.

## What differs from upstream

| # | Change | Files |
|---|---|---|
| 1 | Five more web-bundled plugins, vendored: Australian Markets (gloom-au), ACGB curve (gloom-acgb), ABC News (gloom-abcnews), Newsmap and Hacker News | `package.json`, `bun.lock`, `src/plugins/web-bundled.ts`, `src/utils/plugin-proxy-hosts.json` (generated), `vendor/`, `scripts/vendor-plugin.sh`, `bunfig.toml` |
| 1a | The web build also reads each plugin's `gloom.json` (hosts; id and `web` target must agree), and compiles `vendor/<name>` when present | `scripts/web-plugins.ts`, `scripts/build-web.ts`, `scripts/generate-web-proxy-hosts.ts` |
| 2 | Gloom session restore reports unexpected errors instead of swallowing them (it was already non-blocking) | `src/renderers/browser/cloud-transport.ts`, `src/renderers/browser/main.tsx` |
| 3 | Plugin proxy policy switch and credential stripping; Access credentials stripped from `/api/*` | `src/renderers/cloudflare/http-proxy.ts`, `src/renderers/cloudflare/worker.ts` |
| 4 | Private first-visit layouts | `src/renderers/browser/private-default-config.ts`, `src/renderers/browser/config-host.ts` |
| 5 | Deployment config, CI, the manual deploy workflow and this document | `wrangler.private.jsonc`, `.github/workflows/private-web.yml`, `.github/workflows/deploy-private.yml`, `docs/private-web-deployment.md` |
| 6 | The CSP admits YouTube's embedded player as a frame (`frame-src https://www.youtube.com`), for ABC News | `src/renderers/cloudflare/worker.ts` |

Tests: `src/renderers/cloudflare/http-proxy.test.ts`, `src/renderers/cloudflare/worker.test.ts`,
`src/renderers/browser/cloud-transport.test.ts`, `src/renderers/browser/config-host.test.ts`,
`scripts/web-plugins.test.ts`.

Every downstream hunk is marked with a `Downstream` comment. `git grep -n Downstream` lists them.

### Plugin proxy policy

`PRIVATE_WEB_DEPLOYMENT` (a Worker variable, set only in `wrangler.private.jsonc`)
decides one thing: whether `/http-proxy` requires a Gloom session. Upstream
confirms that session with `api.gloom.sh` (`proxy-session.ts`, cached for a
minute) and rate-limits each signed-in user to 300 plugin requests a minute per
isolate. Only the exact string `"true"` skips that check; anything else,
including unset, keeps upstream's behaviour (fail closed). Because the
per-user rate limit hangs off the session check, private mode has no rate
limit of its own: Cloudflare Access is what limits who can call the route (see
the optional WAF rule below).

Unchanged in both modes: POST only; the browser's same-origin `Origin` header
required (upstream made it mandatory, which the fork previously added only for
private mode); request envelopes over 1 MiB refused; `https:` only; default
port only; no credentials in the URL; no IP literals or `localhost`; host must be
on the generated allowlist (exact or subdomain match on a label boundary);
upstream method set (`GET HEAD POST PUT PATCH DELETE`); hop-by-hop headers
dropped; the upstream request is built only from the envelope (the caller's
own cookies and headers are never forwarded); 20 s default / 30 s maximum
timeout; responses over 5 MiB refused; third-party `Set-Cookie` returned inside
the JSON envelope, never as a header; the CSP and security headers on every
response.

Also upstream now, in both modes (the fork first added these, and upstream has
since shipped its own): redirects are followed manually, at most 5 hops, and
every hop must pass the same target validation; `Authorization`, `Cookie` and
`Proxy-Authorization` are dropped when a hop changes origin; a declared
`Content-Length` over the limit is refused before the body is read.

Added in both modes (downstream): Gloom session cookies, `CF_Authorization` and
`cf-access-*` headers are removed even if plugin code puts them in the
envelope.

## Plugin inventory

| Package | Source | Pinned commit | Plugin id | Hosts it adds |
|---|---|---|---|---|
| gloom-polls | `github:gloom-sh/gloom-polls` | `90a780e` (bun.lock) | polls | api.votehub.com |
| gloom-prediction-markets | `github:gloom-sh/gloom-prediction-markets` | `1d8036f` (bun.lock) | prediction-markets | gamma-api / clob / data-api.polymarket.com, api.elections.kalshi.com |
| **gloom-au** | `vendor/gloom-au` (from private `caelyx/gloom-au`) | `be062e4ed44a2b2c3139de9a499dca90d5cdff6a` | au-markets | www.asx.com.au, asx.api.markitdigital.com, cdn-api.markitdigital.com, download.asic.gov.au, www.asic.gov.au, www.rba.gov.au, data.api.abs.gov.au, www.abs.gov.au, www.abc.net.au, api.tenders.gov.au, cdn.cboe.com, visualisations.aemo.com.au, takeovers.gov.au, www.tga.gov.au, scanner.tradingview.com, api.openelectricity.org.au |
| **gloom-acgb** | `vendor/gloom-acgb` (from private `caelyx/gloom-acgb`) | `cbf5ab600715b02852d3af8a5ffd0cb461f7f03c` | acgb-curve | www.rba.gov.au, home.treasury.gov |
| **gloom-abcnews** | `vendor/gloom-abcnews` (from private `caelyx/gloom-abcnews`) | `4b3003f1335b85a2fca5dcd303a89446fa794fda` | abc-news | youtube.com, www.youtube.com, googlevideo.com, ytimg.com |
| **gloom-newsmap** | `vendor/gloom-newsmap` (from private `caelyx/gloom-newsmap`) | `de8117446f185dbf3d73ed9bb51c3f410befebc5` | newsmap | news.google.com, generativelanguage.googleapis.com |
| **gloom-hackernews** | `vendor/gloom-hackernews` (from public `caelyx/gloom-hackernews`, a fork of `gloom-sh/gloom-hackernews`) | `aeb2ceae33dfd6662676c485f9d705ff38400ef9` | hackernews | hacker-news.firebaseio.com, generativelanguage.googleapis.com |

gloom-au replaces the earlier gloom-asx plugin: it carries ASX announcements
(`ASXA`, with `ASX` as an alias).

ABC News (`TVABC`) cannot resolve YouTube streams on the web: its resolver,
youtubei.js, needs the native process the web build lacks, and a stream URL
resolved through `/http-proxy` would be bound to the worker's address rather
than the viewer's. Its browser entry instead plays live and stories in
YouTube's embedded player, which is why the CSP admits
`frame-src https://www.youtube.com` (change 6), and lists stories from the
channel's feed through `/http-proxy`: the latest fifteen uploads rather than
the desktop's forty-five. Only `www.youtube.com` is actually proxied, but the
plugin declares all four of its hosts for the desktop and terminal, which do
reach googlevideo.com and ytimg.com, and the allowlist takes them all. That is
a deliberate choice: the extra hosts are reachable only past Cloudflare Access,
and narrowing them would mean a per-plugin override here or an understated
declaration in the plugin. Embedded playback was checked only in headless
Chromium (the player loads, live resolves to the current stream); confirm
sound and picture in a real browser after deploying.

Newsmap and Hacker News read linked articles in place. On the web those
requests go through `/http-proxy`, which only reaches the hosts above, so an
article on any other site shows the plugin's fetch error there; the allowlist
is deliberately not widened to arbitrary hosts. Gemini summaries
(generativelanguage.googleapis.com) need a Gemini API key in the plugin's
settings ("Set up Hacker News" or "Set up News Heatmap" in the command bar); it
is stored in that browser only.

Fear & Greed, IPO Calendar and Market Halts are built-in plugins upstream, not
bundled packages. The other hosts in the generated allowlist come from
upstream's built-ins.

The allowlist is generated, never hand-edited: `bun run web:proxy-hosts` writes
`src/utils/plugin-proxy-hosts.json` from the built-in browser catalog plus every
package in `WEB_BUNDLED_PLUGIN_PACKAGES`; `bun run web:proxy-hosts:check` (CI)
fails when it is stale, and `bun run web:build` fails when a bundled plugin
declares a host that is not in it.

To bump an installed plugin: change its commit in `package.json` (or
`bun update <package>` for the unpinned upstream ones), `bun install`, then
`bun run web:proxy-hosts` if its hosts changed, and commit `bun.lock`.

The build fails (no bypass flag) when a listed plugin is not installed, does not
bundle, cannot be evaluated, exports no valid plugin, does not declare `web` in
its module or in `gloom.json`, has a `gloom.json` whose id differs from the
module's, or declares a host that is not a bare domain.

### Vendored plugins

`gloom-au`, `gloom-acgb`, `gloom-abcnews` and `gloom-newsmap` live in private repositories,
which Bun cannot install from in CI (it downloads `github:` dependencies without
credentials). Their code is copied into this repository under `vendor/`
instead, with `git subtree --squash`, by `scripts/vendor-plugin.sh`. The plugin
repositories stay private; only the files copied here are public.
`gloom-hackernews` is public but is vendored the same way, so every plugin this
fork adds updates with the same script.

- The script leaves out `CLAUDE.md`, `AGENTS.md`, `.claude`, `docs/research`,
  and gloom-au's working notes `STATUS.md` and `docs/australian-data-parity.md`
  (the list is `EXCLUDED_PATHS` at the top of the script). The plugins' own
  history never enters this repository: the import is a squashed, filtered
  snapshot.
- They are not package dependencies. `scripts/web-plugins.ts` compiles
  `vendor/<name>` directly when it exists, because installing a folder
  dependency makes Bun install its devDependencies too. A vendored plugin's
  runtime dependencies are devDependencies of this repository instead, pinned
  to the versions the plugin's own `bun.lock` resolves: `unpdf` (gloom-au),
  `papaparse` (gloom-acgb), `@mozilla/readability` and `linkedom`
  (gloom-newsmap, gloom-hackernews). A missing one fails the web build.
  gloom-abcnews's `youtubei.js` is the exception: only its native entry imports
  it, and the web build compiles the browser entry, so it is not installed here.
- `bunfig.toml` keeps `vendor/**` out of `bun test`; the plugins' tests run in
  their own repositories. The typecheck projects list their files explicitly and
  do not include `vendor/`.
- Do not edit files under `vendor/` here; change the plugin repository and
  update the copy.

To update one (needs read access to the private repository, and a clean tree):

```sh
scripts/vendor-plugin.sh gloom-au https://github.com/caelyx/gloom-au.git <commit-or-branch>
scripts/vendor-plugin.sh gloom-acgb https://github.com/caelyx/gloom-acgb.git <commit-or-branch>
scripts/vendor-plugin.sh gloom-abcnews https://github.com/caelyx/gloom-abcnews.git <commit-or-branch>
scripts/vendor-plugin.sh gloom-newsmap https://github.com/caelyx/gloom-newsmap.git <commit-or-branch>
scripts/vendor-plugin.sh gloom-hackernews https://github.com/caelyx/gloom-hackernews.git <commit-or-branch>
```

Each run adds a merge commit whose message records the source commit
(`vendor-plugin-source: <sha>`). Then: if the plugin's `package.json`
`dependencies` changed, mirror them in this repository's devDependencies and
`bun install`; `bun run web:proxy-hosts` if its hosts changed; and the checks
below.

### ASX PDF extracts on the web (gloom-au)

The proxy envelope carries response bodies as text (`response.text()`), which
corrupts binary PDFs. Real ASX PDFs are binary (compressed streams), so on the
web and desktop renderers the inline extract will normally show "Inline extract
unavailable… open the original PDF", whatever the size. Only a PDF that happens
to be plain ASCII survives. This is an upstream transport limitation, not the
5 MiB limit; fixing it means a binary-safe envelope (e.g. base64 bodies for
non-text content types) in `src/utils/http-proxy-response.ts`, its client, and
the desktop backend. Best done upstream.

## Default configuration

`src/renderers/browser/private-default-config.ts` holds what a first visit
opens with: the amber theme and eight layouts (Home, ASX, NMAP, Futures,
Monitor, US, Macro and Temp), taken from a desktop config backup's `theme` and
`layouts`, the backup's active layout first. They replace upstream's
first-visit layouts and theme. A research deep link (`/?ticker=…`) opens
upstream's Research layout first, with these after it. Set
`PRIVATE_DEFAULT_LAYOUTS` or `PRIVATE_DEFAULT_THEME` to `null` to go back to
upstream's.

Left out of the backup: everything other than the layouts and theme (keys,
portfolios, plugin settings, recent tickers), the `abc-news` pane (gloom-abcnews
has no web target), the news pane's cached headlines and the portfolio cursor.
`sovr-board` is written as `cdx-board` on its Sovereign tab, as config version
25 folds it. The US tab's heatmap shows the portfolio, which starts empty in a
new browser. Some panes read Gloom Cloud and may ask the visitor to sign in.

### A saved config always wins

The defaults apply only when the browser has no saved config
(`gloomberb.web.config.v1` in `localStorage`). The app saves one on the first
visit, and a saved config is always loaded as is and never rewritten, so a
browser that has opened the site before keeps its own layouts after a deploy
changes the defaults. To pick up new defaults in such a browser, clear its saved
config:

- In the app: run **Reset All Data** from the command bar (Ctrl+K), confirm,
  then reload the page. On the web the app keeps running after the reset, so
  reload straight away. It clears everything the app keeps in that browser's
  storage: layouts, portfolios and watchlists, plugin settings (including any
  Gemini key) and saved pane snapshots. It does not sign you out of Gloom or
  Cloudflare Access, which are cookies.
- Or in the browser: open the site, open developer tools, and under
  Application (Chrome, Edge) or Storage (Firefox) > Local Storage, delete the
  `gloomberb.web.config.v1` entry for the site, or all the `gloomberb.web.*`
  entries, then reload. Deleting only the config entry keeps the other saved
  data. "Clear site data" also works, but it also clears the Cloudflare Access
  cookie, so the next visit asks you to sign in to Access again.

Clearing a saved config cannot be undone: export anything you want to keep
first (the desktop app's Export Config; the web app has no config export).

## Build and test locally

```sh
bun install --frozen-lockfile
bun run typecheck
bun run web:proxy-hosts:check
bun test src/renderers/cloudflare src/renderers/browser/cloud-transport.test.ts \
  src/renderers/browser/config-host.test.ts scripts/web-plugins.test.ts
bun run web:audit                       # builds dist/web with all bundled plugins
bunx wrangler dev --config wrangler.private.jsonc --port 8787
# open http://localhost:8787 in a fresh profile
```

`bun run private:dry-run` builds and runs `wrangler deploy --dry-run` against the
private config; its output must list `env.PRIVATE_WEB_DEPLOYMENT ("true")`.

## Deploy to Cloudflare

The deployment is the Worker `main` at `https://main.privategloom.workers.dev`
(`<worker name>.<account's workers.dev subdomain>`), deployed by the manual
**Deploy private web** workflow (`.github/workflows/deploy-private.yml`). It
runs only from `feature/private-deployment` and only when started by hand
(Actions > Deploy private web > Run workflow, choosing that branch). It uses two repository secrets, `CF_ACCT` (account ID) and
`CF_TKN` (API token, "Edit Cloudflare Workers" permissions). They are named
differently from the `CLOUDFLARE_*` secrets upstream's Verify workflow deploys
term.gloom.sh with, so that job never picks them up. No secrets are stored in
the repository.

The workflow fails closed on Access:

1. Before deploying, `GET /health` must redirect to a `*.cloudflareaccess.com`
   login. If it does not (no Worker yet, Access off, or the app answering), it
   stops without deploying.
2. It then checks the allowlist, runs the private-deployment tests, builds, and
   deploys `wrangler.private.jsonc`.
3. After deploying, the same check must pass. If the site answers without
   Access, it redeploys with the `workers.dev` route switched off (or, if that
   fails, deletes the Worker), so the site goes offline rather than staying
   open, and the run fails.

First deploy: the Worker has to exist before Access can be switched on for its
`workers.dev` route. In the Cloudflare dashboard, create a Hello World Worker
named `main`, enable Access on it (below), then run the workflow; it replaces
the Hello World code.

To deploy by hand instead: `bun run web:build && bunx wrangler deploy --config
wrangler.private.jsonc` with `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`
set, after checking Access yourself.

### Cloudflare Access requirements

- In Workers & Pages > `main` > Settings > Domains & Routes, enable Cloudflare
  Access on the `workers.dev` route, and edit the Access application it creates
  so its policy allows only your identity (e.g. your email address). Do not add
  Bypass or Service Auth policies.
- The Access application covers the whole hostname, so static assets,
  `/api/*`, `/http-proxy`, `/health`, `/s/*` and `/l/*` are all behind it.
- `preview_urls` is off in `wrangler.private.jsonc`; keep it off. Preview URLs
  are separate hostnames.
- A custom domain later: add a `routes` entry with `custom_domain: true`, create
  an Access application for that hostname first, and update `SITE` in the
  deploy workflow.
- No callback routes need special treatment: Gloom sign-in is email/password
  (`/api/auth/sign-in/email`) or a QR/device flow that polls `/api/auth/device/*`,
  both same-origin calls already behind Access; there is no OAuth redirect
  back to this hostname. Email verification and password-reset links are sent
  by Gloom; where they point was not checked (most likely Gloom's own pages).
- When the Access session expires, the app's background requests are
  redirected to the Access login and fail; reloading the page signs back in to
  Access. The app treats those failures like "API unreachable" and keeps the
  workspace open.
- Optional: a WAF rate-limiting rule on `/http-proxy` limits what a compromised
  Access identity could spend (WAF rules need a zone, so not on `workers.dev`).

### Not verified here: Gloom sign-in from a non-Gloom hostname

`/api/*` forwards the browser's `Origin` (your private hostname) to
`api.gloom.sh`. If Gloom's API only accepts its own origins for sign-in, or sets
its session cookie with a `Domain` attribute for gloom.sh, signing in to Gloom
from a private hostname will fail. This fork deliberately does not rewrite
`Origin` or cookies to get around that: it would be circumventing Gloom's
controls. Test sign-in once after the first deploy. If it fails, the workspace
and public-data plugins still work; Cloud features would need Gloom to allow
the origin.

## Keeping up with upstream

The fork's `main` mirrors upstream `gloom-sh/gloomberb` `main` and carries no
downstream changes; everything in this document lives on the long-lived
`feature/private-deployment` branch. To sync: bring `main` up to upstream (a
fast-forward, or GitHub's "Sync fork"), then merge `main` into
`feature/private-deployment`. Never commit downstream changes to `main`, with
one exception: `.github/workflows/deploy-private.yml` is also on `main`, because
GitHub only offers Run workflow for a `workflow_dispatch` workflow on the
default branch. Keep the two copies identical (edit it here, then copy it to
`main`) so merging `main` into this branch never conflicts; the copy on the
branch you pick is the one that runs.

Files most likely to conflict on a merge from upstream, in order of risk:

1. `bun.lock` / `package.json` - regenerate with `bun install`, never hand-merge.
   `src/utils/plugin-proxy-hosts.json` likewise: `bun run web:proxy-hosts`.
2. `src/renderers/cloudflare/http-proxy.ts` - the `policy` option around the
   session gate in `handleHttpProxy`, and the header stripping in
   `upstreamHeaders`.
3. `src/renderers/cloudflare/worker.ts` - `WorkerEnv`, the `/http-proxy` call,
   `proxyApi`, and `frame-src` in the CSP of `SECURITY_HEADERS`.
4. `src/renderers/browser/config-host.ts` - one `if` in `createBrowserDefaultConfig`.
5. `src/renderers/browser/cloud-transport.ts`, `main.tsx` - the session-restore
   function and its one call.
6. `scripts/web-plugins.ts`, `build-web.ts`, `generate-web-proxy-hosts.ts` - the
   `hosts` field on compiled plugins and the `vendor/` lookup.
7. `src/plugins/web-bundled.ts` - the downstream list entries.
8. `knip.jsonc` - the downstream `ignoreDependencies` entries.

`vendor/`, `scripts/vendor-plugin.sh` and `bunfig.toml` are downstream-only and
do not conflict.

After each merge: `bun install`, `bun run web:proxy-hosts`, the test and build
commands above, and a fresh-profile check of the signed-out workspace.
