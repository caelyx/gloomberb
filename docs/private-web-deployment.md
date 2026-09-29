# Private web deployment

This fork adds a small set of changes so the browser build can run as a private
deployment behind Cloudflare Access, with extra bundled plugins, and without
requiring a Gloom Cloud sign-in to open the workspace or use public-data
plugins. Gloom Cloud itself is not modified or self-hosted: `/api/*` still goes
to `https://api.gloom.sh`, and Gloom's own authentication rules still apply to it.

Baseline: upstream `gloom-sh/gloomberb` at `62317c477c1ef9b8394a12eac971c5546441b76e`
("Offer to install an official plugin when its code is typed in the command bar
(#1212)", 29 September 2026).

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
browser ──(Access login)──▶ Cloudflare Access ──▶ Worker (gloomberb-private)
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
| 1 | Three more web-bundled plugins: Hacker News pinned by commit, Newsmap and ASX vendored | `package.json`, `bun.lock`, `src/plugins/web-bundled.ts`, `src/utils/plugin-proxy-hosts.json` (generated), `vendor/`, `scripts/vendor-plugin.sh`, `bunfig.toml` |
| 1a | The web build also reads each plugin's `gloom.json` (hosts; id and `web` target must agree), and compiles `vendor/<name>` when present | `scripts/web-plugins.ts`, `scripts/build-web.ts`, `scripts/generate-web-proxy-hosts.ts` |
| 2 | Gloom session restore reports unexpected errors instead of swallowing them (it was already non-blocking) | `src/renderers/browser/cloud-transport.ts`, `src/renderers/browser/main.tsx` |
| 3 | Plugin proxy policy switch, redirect re-validation, credential stripping, early size check; Access credentials stripped from `/api/*` | `src/renderers/cloudflare/http-proxy.ts`, `src/renderers/cloudflare/worker.ts` |
| 4 | Private first-visit layout | `src/renderers/browser/private-default-config.ts`, `src/renderers/browser/config-host.ts` |
| 5 | Deployment config, CI and this document | `wrangler.private.jsonc`, `.github/workflows/private-web.yml`, `docs/private-web-deployment.md` |

Tests: `src/renderers/cloudflare/http-proxy.test.ts`, `src/renderers/cloudflare/worker.test.ts`,
`src/renderers/browser/cloud-transport.test.ts`, `src/renderers/browser/config-host.test.ts`,
`scripts/web-plugins.test.ts`.

Every downstream hunk is marked with a `Downstream` comment. `git grep -n Downstream` lists them.

### Plugin proxy policy

`PRIVATE_WEB_DEPLOYMENT` (a Worker variable, set only in `wrangler.private.jsonc`)
decides one thing: whether `/http-proxy` requires a Gloom session cookie. Only
the exact string `"true"` turns the requirement off; anything else, including
unset, keeps upstream's behaviour (fail closed). In private mode the browser's
`Origin` header becomes mandatory (it must equal the Worker's own origin),
because the session check no longer vouches for the caller.

Unchanged in both modes: POST only; same-origin `Origin`; `https:` only; default
port only; no credentials in the URL; no IP literals or `localhost`; host must be
on the generated allowlist (exact or subdomain match on a label boundary);
upstream method set (`GET HEAD POST PUT PATCH DELETE`); hop-by-hop headers
dropped; the upstream request is built only from the envelope (the caller's
own cookies and headers are never forwarded); 20 s default / 30 s maximum
timeout; responses over 5 MiB refused; third-party `Set-Cookie` returned inside
the JSON envelope, never as a header; the CSP and security headers on every
response.

Added in both modes (hardening): redirects are followed manually, at most 5
hops, and every hop must pass the same target validation (upstream's
`redirect: "follow"` would have followed an allowlisted host's redirect
anywhere); `Authorization` and `Cookie` are dropped when a hop changes origin;
Gloom session cookies, `CF_Authorization` and `cf-access-*` headers are removed
even if plugin code puts them in the envelope; a declared `Content-Length` over
the limit is refused before the body is read.

## Plugin inventory

| Package | Source | Pinned commit | Plugin id | Hosts it adds |
|---|---|---|---|---|
| gloom-fear-greed | `github:gloom-sh/gloom-fear-greed` | `4493708` (bun.lock) | fear-greed | production.dataviz.cnn.io |
| gloom-ipo-calendar | `github:gloom-sh/gloom-ipo-calendar` | `c3917c2` (bun.lock) | ipo-calendar | stockanalysis.com |
| gloom-polls | `github:gloom-sh/gloom-polls` | `90a780e` (bun.lock) | polls | api.votehub.com |
| gloom-prediction-markets | `github:gloom-sh/gloom-prediction-markets` | `1d8036f` (bun.lock) | prediction-markets | gamma-api / clob / data-api.polymarket.com, api.elections.kalshi.com |
| **gloom-hackernews** | `github:gloom-sh/gloom-hackernews` | `6447013f526daedf73699334958672645024dc8c` | hackernews | hacker-news.firebaseio.com (declared in its gloom.json only) |
| **gloom-newsmap** | `vendor/gloom-newsmap` (from private `caelyx/gloom-newsmap`) | `f27e6950f6bfb1070ea25a0d4f8ce2ffda34aa2f` | newsmap | news.google.com |
| **gloom-asx** | `vendor/gloom-asx` (from private `caelyx/gloom-asx`) | `bd13e937028224dba64cb0424549b5eb5415f953` | asx-announcements | asx.api.markitdigital.com, cdn-api.markitdigital.com |

Market Heatmap (api.nasdaq.com, query1/query2/fc.yahoo.com) and Market Halts
(nasdaqtrader.com) are built-in plugins, not bundled packages.

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

### Vendored private plugins

`gloom-newsmap` and `gloom-asx` live in private repositories, which Bun cannot
install from in CI (it downloads `github:` dependencies without credentials).
Their code is copied into this repository under `vendor/` instead, with
`git subtree --squash`, by `scripts/vendor-plugin.sh`. The plugin repositories
stay private; only the files copied here are public.

- The script leaves out `CLAUDE.md`, `AGENTS.md`, `.claude` and `docs/research`
  (the list is `EXCLUDED_PATHS` at the top of the script). The plugins' own
  history never enters this repository: the import is a squashed, filtered
  snapshot.
- They are not package dependencies. `scripts/web-plugins.ts` compiles
  `vendor/<name>` directly when it exists, because installing a folder
  dependency makes Bun install its devDependencies too (for gloom-asx, that
  includes the published `gloomberb` package). A vendored plugin's runtime
  dependencies are devDependencies of this repository instead: `unpdf` (for
  gloom-asx). A missing one fails the web build.
- `bunfig.toml` keeps `vendor/**` out of `bun test`; the plugins' tests run in
  their own repositories. The typecheck projects list their files explicitly and
  do not include `vendor/`.
- Do not edit files under `vendor/` here; change the plugin repository and
  update the copy.

To update one (needs read access to the private repository, and a clean tree):

```sh
scripts/vendor-plugin.sh gloom-asx https://github.com/caelyx/gloom-asx.git <commit-or-branch>
scripts/vendor-plugin.sh gloom-newsmap https://github.com/caelyx/gloom-newsmap.git <commit-or-branch>
```

Each run adds a merge commit whose message records the source commit
(`vendor-plugin-source: <sha>`). Then: if the plugin's `package.json`
`dependencies` changed, mirror them in this repository's devDependencies and
`bun install`; `bun run web:proxy-hosts` if its hosts changed; and the checks
below. Note that gloom-asx's test fixtures include two ASX responses that are
byte-identical to files in its excluded `docs/research/samples/`.

### ASX PDF extracts on the web

The proxy envelope carries response bodies as text (`response.text()`), which
corrupts binary PDFs. Real ASX PDFs are binary (compressed streams), so on the
web and desktop renderers the inline extract will normally show "Inline extract
unavailable… open the original PDF", whatever the size. Only a PDF that happens
to be plain ASCII survives. This is an upstream transport limitation, not the
5 MiB limit; fixing it means a binary-safe envelope (e.g. base64 bodies for
non-text content types) in `src/utils/http-proxy-response.ts`, its client, and
the desktop backend. Best done upstream.

## Default configuration

`src/renderers/browser/private-default-config.ts` holds the first-visit layout
(currently "Markets": Market Heatmap, News Heatmap, Fear & Greed). It is used
only when the browser has no saved config (`gloomberb.web.config.v1` in
`localStorage`); a saved config is always loaded as is and never rewritten. A
research deep link (`/?ticker=…`) still opens on upstream's Research layout, with
Markets next. Set `PRIVATE_DEFAULT_LAYOUT = null` to go back to upstream's
first-visit workspace. Hacker News (`HN`) and ASX (`ASX <ticker>`, or the ASX tab
of an `.AX` ticker) open from the command bar.

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

1. Edit `wrangler.private.jsonc`: replace `gloom.example.invalid` with your
   hostname (a zone in your Cloudflare account).
2. **Create the Access application first** (below), so the hostname is never
   reachable unprotected.
3. `bun run web:build && bunx wrangler deploy --config wrangler.private.jsonc`
   with `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` in your environment. No
   secrets are stored in the repository.
4. Check: `/health` without an Access session must redirect to the Access login,
   not answer `{"status":"ok"}`.

This fork's `private-web.yml` never deploys. Upstream's `verify.yml` still has a
`deploy-web` job that deploys `--env production` (term.gloom.sh) on pushes to
`main` using the `CLOUDFLARE_*` secrets. In this fork, either disable the
"Verify" workflow in the repository's Actions settings or do not create secrets
with those names.

### Cloudflare Access requirements

- One self-hosted Access application covering the **whole hostname** (no path),
  so static assets, `/api/*`, `/http-proxy`, `/health`, `/s/*` and `/l/*` are
  all behind it. Do not add Bypass or Service Auth policies for `/api/*` or
  `/http-proxy`.
- `workers_dev` and `preview_urls` are off in `wrangler.private.jsonc`; keep
  them off. Those hostnames are not covered by an Access application for the
  custom domain.
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
  Access identity could spend.

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

Files most likely to conflict on a merge from upstream, in order of risk:

1. `bun.lock` / `package.json` - regenerate with `bun install`, never hand-merge.
2. `src/renderers/cloudflare/http-proxy.ts` - the policy switch, redirect loop
   and header stripping sit inside `handleHttpProxy`.
3. `src/renderers/cloudflare/worker.ts` - `WorkerEnv`, the `/http-proxy` call and
   `proxyApi`.
4. `src/renderers/browser/config-host.ts` - one `if` in `createBrowserDefaultConfig`.
5. `src/renderers/browser/cloud-transport.ts`, `main.tsx` - the session-restore
   function and its one call.
6. `scripts/web-plugins.ts`, `build-web.ts`, `generate-web-proxy-hosts.ts` - the
   `hosts` field on compiled plugins and the `vendor/` lookup.
7. `src/plugins/web-bundled.ts` - three list entries.

`vendor/`, `scripts/vendor-plugin.sh` and `bunfig.toml` are downstream-only and
do not conflict.

After each merge: `bun install`, `bun run web:proxy-hosts`, the test and build
commands above, and a fresh-profile check of the signed-out workspace.
