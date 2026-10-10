# Hacker News for Gloomberb

The Hacker News front page as a Gloomberb pane. Top, New, Best, Show, and Ask, with scores, comment counts, and one-key article opening.

This is a fork of [gloom-sh/gloom-hackernews](https://github.com/gloom-sh/gloom-hackernews) that also reads the article in place: opening a link story shows a reader-view extract of the page it links to, and `s` asks Gemini for a short summary.

Requires Gloomberb 0.15.3 or later, for title-bar tabs, `StatGrid`, and the `DetailScrollBody` the article text scrolls in.

```bash
gloomberb install caelyx/gloom-hackernews
```

Then press `HN` in the command bar.

## Article text and summaries

Opening a story that links elsewhere fetches the page and shows its article text under the story's figures, the way a browser's reader view would. [Readability](https://github.com/mozilla/readability) (the parser behind Firefox Reader View) picks the article out of the page and [linkedom](https://github.com/WebReflection/linkedom) gives it a DOM, so no browser or command-line tool is involved. Plain-text pages such as RFCs are read too, with their hard-wrapped lines rejoined into paragraphs. `j`/`k` scroll the text a line at a time.

Some pages can't be read this way, and the pane says so instead: PDFs, pages that answer with an error, pages built entirely in JavaScript, pages over 3 MB, and pages that aren't UTF-8 (Gloomberb decodes every page as UTF-8). Links to `localhost` or a private network address are never fetched, because opening a story requests its URL without a further click. `o` on the story list still opens any of them in the browser.

The page is fetched from the article's own site, so it works in the terminal and the desktop app. The hosted web app only reaches hosts a plugin declares in advance, so it cannot load articles.

To summarise, get a free key from [Google AI Studio](https://aistudio.google.com/apikey), run **Set up Hacker News** from the command bar (or `s` on the plugin in the Plugins pane), and paste it in. Then `s` on an open article asks Gemini for a neutral summary of about 150 words, shown above the article text. Nothing is sent to Google until you press `s`. Free-tier requests may be used by Google to improve its models, and the key is stored in plain text in Gloomberb's config.

The model defaults to `gemini-flash-lite-latest`, Google's alias for the newest Flash-Lite model; any model id that supports `generateContent` can be set in the same form.

## This is also the reference plugin

It is a small, complete Gloomberb plugin that uses only the public `gloomberb/*` API, with two pure-JS dependencies for reading articles. If you are writing your own plugin, start here rather than from scratch.

| File | What it shows |
|---|---|
| `index.tsx` | The whole plugin contract — id, metadata, `targets`, `hosts`, optional setup fields, a pane, and a command-bar template |
| `types.ts` | The plugin and pane ids, the feed list, and the story shape the other files share |
| `client.ts` | Talking to a third-party API through `createThrottledFetch`, and normalizing its responses |
| `article.ts` | Fetching an arbitrary page and reducing it to reader-view paragraphs |
| `summary.ts` | Calling Gemini's `generateContent`, and turning its error and block shapes into messages |
| `pane.tsx` | A table-plus-detail pane using shared components: title-bar tabs, a detail that opens on a `StatGrid`, pane-scoped state, plugin config, and a footer key |
| `*.test.ts` | Testing the parts with real branching: the HN normalizer, article extraction against a saved page, and Gemini response shapes |
| `gloom.json` | The directory manifest: name, icon, `targets`, `hosts`, the pane it contributes, and `minGloom` |

### Getting started

```bash
git clone https://github.com/caelyx/gloom-hackernews my-plugin
cd my-plugin
bun install
bun test
bun run typecheck
```

Rename the ids in `types.ts`, point `client.ts` at your own API, and reshape `pane.tsx`. Then:

```bash
gloomberb install your-github-user/my-plugin
```

### Things worth copying

**Import from `gloomberb/*`, never from a renderer.** `gloomberb/ui`, `gloomberb/components`, `gloomberb/react`, `gloomberb/theme`, and `gloomberb/utils` are the renderer contract. A plugin that imports OpenTUI, Electrobun, or DOM APIs directly stops working on the other two renderers.

**Declare `targets` honestly.** This plugin makes HTTPS reads and parses HTML in pure JS, so it runs everywhere. Anything using Node builtins is not web-capable, and the registry verifies this with an import scan rather than trusting the declaration.

**Use `createThrottledFetch`.** It provides rate limiting, retries, timeouts, and request deduplication, and it routes through the host's transport — which is what lets the same code run in the terminal and in the browser.

**Keep pane state in `usePluginPaneState`.** It is scoped per pane instance, so two copies of the pane in one layout stay independent and both survive a restart.

**Put status in the footer, not the body.** Only things that change — loading, error, staleness — belong there.

**Let the host draw the chrome.** `usePaneHeaderTabs` puts the feed strip in the desktop title bar and returns false in the terminal, where the pane draws its own `Tabs`. An open story starts on a `StatGrid` of its figures, because the stack bar already names it.

## Development

`gloomberb` and `react` are peer dependencies, never real ones. Gloomberb symlinks its own copies into every plugin directory on install and on load, so there is exactly one instance of each in the process — two copies of React would throw on the first hook. CI links the host the same way, which is why it typechecks against the same module graph that runs in production.

```bash
git clone --depth 1 https://github.com/gloom-sh/gloomberb.git /tmp/gloomberb
bun install --cwd /tmp/gloomberb
ln -sfn /tmp/gloomberb node_modules/gloomberb
ln -sfn /tmp/gloomberb/node_modules/react node_modules/react
```

## License

MIT
