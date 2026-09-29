# Prompt for the live-testing session

Copy everything below the line into a Claude Code session running on a machine
that can reach asx.com.au and markitdigital.com, with this repository checked
out.

The first pass ran on 29 September 2026 (see `docs/live-testing.md`). Use this
prompt to re-verify after the service changes; the fixtures are now real, so
step 3 means refreshing them rather than replacing synthetic ones.

---

You are working in the `gloom-asx` repository, a Gloomberb plugin that shows
ASX company announcements for the selected ticker. It was written without
network access to the ASX or Markit Digital hosts, so the endpoint URLs, JSON
field names and PDF behaviour in `src/asx/` are assumptions and the test
fixtures are synthetic. Your job is to verify those assumptions against the
live service, fix what is wrong, and leave the repository green with real
fixtures.

Read `docs/live-testing.md` first and follow it step by step. It contains the
politeness rules, the probe command, a table mapping each probe check to the
code that embodies the assumption, and the manual checks to run inside
Gloomberb. Also read `docs/research/01-asx-announcement-data-sources.md` for
background.

Hard constraints:

- Make at most 10 requests to the live hosts in total. Use `bun run probe`
  as documented; do not write ad-hoc loops, do not poll, do not fetch multiple
  tickers, and do not fetch the whole-market endpoint.
- Keep the plugin's identifying `User-Agent`. If the service rejects it,
  report that and stop rather than impersonating a browser.
- Do not commit PDFs. Commit the JSON captures under `docs/research/samples/`
  and the fixtures derived from them.
- Work on a branch and open a pull request against `main`. Do not push to
  `main`.
- Use Australian English in anything you write.

Deliverables, in order:

1. `bun install`, `bun test`, `bun run typecheck` pass before you change
   anything. Report the numbers.
2. `bun run probe CBA`, then `bun run probe CBA --pdf`. Paste the report
   lines (`L1` to `L13`) into your summary. For every `FAIL`, change the code
   the table in `docs/live-testing.md` points to, and re-run the probe once.
3. Promote the captures to fixtures (`docs/live-testing.md`, step 3) and
   update `src/asx/parse.test.ts` to real values. Tests must stay green.
4. Install the plugin into a local Gloomberb (`gloomberb install <path>`) and
   run through the manual checks in step 4. Report each as pass or fail, with
   what you saw. Fix what you can in the pane; describe what you cannot.
5. Update sections 2.1 and 6 of the research note with what the probe
   showed, including any rate-limit or cache headers. Section 4 (terms of
   use) is settled and needs no work.
6. Update the README status line, commit, and open the pull request. In the
   PR description list every assumption that turned out wrong and how you
   changed it, and every remaining unknown.

If anything blocks you (a 403, a CAPTCHA page, an unexpected JSON shape you
cannot map), stop and describe exactly what you saw, including the raw
response saved under `docs/research/samples/`, rather than guessing or
retrying.
