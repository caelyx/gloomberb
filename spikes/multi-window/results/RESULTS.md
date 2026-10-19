# Spike results: run 1 (2026-10-19)

**Setup:** Mac Studio (M1).
- Primary display: Apple Studio Display, on the left. Display id 4, 3200×1800 points at 2× scale.
- Secondary display: LG 24-inch 4K, on the right. Display id 2, 3008×1692 points at 2× scale, positioned 173 points lower than the primary.
- "Displays have separate Spaces": **on**.

**Inputs:** the filled-in checklist (`../README.md`), the log (`run-1.log`) and the saved frames (`run-1-frames.json`). Line numbers below (`log:N`) refer to `run-1.log`.

**Not tested:** B7, C4, D6 and G. C5 and D5 are answered from the log.

## Summary

| Q | Question | Result |
|---|---|---|
| Q1 | Full screen per display, and restore at launch | **Works.** One problem with window position on the second display (see 1b). |
| Q2 | Native focus tracking | **Native events are reliable; page focus events are not.** |
| Q3 | Cmd-K routed to the focused window | **Routing works, and main is not raised.** Cmd-K fires twice. There is a separate Electrobun bug that drops menu-item data after the first click. |
| Q4 | Backtick | **Works.** It opens the bar in the focused window, and types normally in text fields. |
| Q5 | Window lifecycle | Close and reopen work. Closing main leaves window 2 running. Cmd-W does nothing in a full-screen window. |

## Findings

### 1a. Full screen works per display, including restore at launch (Q1)

- Both windows were full screen at the same time, each on its own display (log:44–45, log:77–79).
- The green button and the API behaved the same (log:53–60).
- After quitting with both windows full screen, a relaunch that called `setFullScreen(true)` straight after creating each window brought **both back full screen, on the correct displays**. `isFullScreen` was `true` at both the 1 s and the 3 s checks (log:82–97).
- `isFullScreen()` reads correctly about 150–250 ms after each transition, when the resize settles. That is consistent with Gloomberb's current approach of checking after a resize.

### 1b. Windows on the second display creep upwards (observed; cause is a hypothesis)

Positions read back from a window on the second display don't match the positions set:

| Set y | Read back y | Log |
|---|---|---|
| 244 | 136 | log:12–13 |
| 276 | 168 | log:30 → log:102 (restore at launch) |
| 168 | 96 | log:313 → log:317 |

- Main, on the primary display, never drifts (y = 71 throughout).
- The first two cases differ by **108 points, which is exactly 1800 − 1692**, the difference in height between the two displays. Hypothesis: Electrobun converts between top-left and macOS's bottom-left coordinates using the wrong display's height. The third case differs by 72, which this does not explain.
- Effect: each save-and-restore cycle moves window 2 upwards. That matters for D2 (frames saved per machine), and probably already affects Gloomberb's single-pane pop-out windows. Not yet checked in Gloomberb.
- Next step: a short follow-up run of B7 (relaunch several times without full screen), and a frame read-back immediately after `setFrame`.

### 2. Native focus/blur are reliable; page focus is not (Q2)

- **Native events always fired.** Every focus change has a `native-focus` / `native-blur` pair. Where both kinds fired, the native one arrived **0–20 ms before** the page's (e.g. log:119–138).
- **Page focus events were missed many times:**
  - log:22–48: main gained native focus repeatedly (around fullscreen transitions and title-bar clicks) with no `dom-focus` for about 85 s;
  - log:313–324: window 2 created, then focused several times, before its first `dom-focus`;
  - log:8–9: 6 s between native and page focus.
- **Spurious pairs:** a blur immediately followed by a focus on the *same* window, in the same millisecond, during fullscreen transitions (log:23–24, log:67–68). Harmless if the handler is idempotent.
- **Consequence for the plan:** Bun tracks the active window from native events (§4.3), and views do not report focus.
- **Possible existing bug (inference, not tested):** `DetachedPaneShell` tracks window focus with page `focus`/`blur` events (`src/components/layout/detached-pane-shell.tsx:112-133`). That may leave a pop-out window's pane looking unfocused after a fullscreen transition.

### 3a. Cmd-K fires twice, and routing works (Q3)

- **Routing:** Bun routed the menu accelerator to the focused window using native focus (`menu-routed … target: "w2", via: "native-focus"`, log:176). Main was not raised (D1).
- **Double firing is confirmed:** one Cmd-K produced both a `menu-clicked` and a page `keydown` within 1 ms. The fake bar opened and then closed (log:175–179; your D2 "opened quickly and then closed").
- Cmd-K still reaches the page while a text field has focus (D4).
- **Held key:** holding Cmd-K for about 1.8 s produced about 25 menu clicks *and* about 25 page `keydown` repeats, toggling the bar each time (log:217–267). Gloomberb already suppresses repeated menu clicks. I have not confirmed that its page-side shortcut handler ignores `event.repeat`.
- **Proposed design:**
  - route the menu command to the window with native focus;
  - in that window, ignore a menu "open command bar" that arrives within about 150 ms of a page Cmd-K. They arrived 0–6 ms apart here.
  - Mouse clicks on the menu item have no matching key press, so they still work.

### 3b. Electrobun drops menu-item data after the first click (confirmed in source)

- **What happened:** after the first Cmd-K, every later "Open Command Bar" click arrived with **no command data** (log:181, 184, 192, … `menu-clicked` without `command`). Clicking the menu item with the mouse did nothing (D7; log:207, 211, 228). Each other item worked on its first and only use.
- **Cause:** in Electrobun 1.18.1, `dist/api/bun/proc/native.ts`, `deserializeMenuAction` deletes the item's data from its registry the first time it is used:
  ```ts
  data = getMenuData(dataId);
  // Clean up data from registry after use
  clearMenuData(dataId);
  ```
  The menu still points at the same entry, so every later click gets `undefined`.
- **Gloomberb is very likely affected today (inference, not tested in Gloomberb):**
  - It passes every menu command through `data` (`src/renderers/electrobun/bun/application-menu/index.ts:14-25`).
  - It only rebuilds the menu when keybindings change (`src/renderers/electrobun/bun/desktop/backend.ts:144`).
  - So each Gloomberb menu item that carries a command probably works **once per launch**. In the main window this is mostly hidden, because Cmd-K also arrives as a page key press.
  - **Quick check in real Gloomberb:** click View → Open Command Bar (with the mouse) twice, or Layout → Tidy Windows twice.
- **Fix:** Gloomberb-side. Carry the command in the `action` string, which is not deleted, or in Gloomberb's own lookup table, instead of in `data`. It is small, independent of the multi-window work, and should come first. It is also worth reporting upstream. Electrobun 2.0.4 exists, but its npm package no longer contains the source, so I couldn't check whether it is fixed there. Moving to 2.x is a major-version change anyway.

### 4. Backtick (Q4)

It opens the bar in the focused window (log:292–293), types normally in a text field (log:212, log:295), and File → Search Ticker routes to the focused window (log:296–298).

### 5. Window lifecycle (Q5)

- **Close and reopen:** closing window 2 kept the app running (log:304). Reopening it put it back on its remembered display (log:313), not full screen, as expected for the spike.
- **Closing main** with the red button left window 2 running and full screen (log:329–332).
  - In Gloomberb, the main window's page is what owns and writes layout state. Secondary windows left behind would have nothing to sync with.
  - **New decision needed (D10):** closing main should either quit the app or close every secondary window. Quitting is my recommendation, since it matches today's main-window close control.
- **Cmd-W** in a full-screen window 2 produced the system beep and nothing else (F3). Cause not investigated. Gloomberb handles its own close shortcuts in the page, so this is low priority, but Window → Close should be checked in Gloomberb's secondary windows.

## Changes to the plan

The architecture is unchanged. The changes:
1. **New prerequisite:** fix the lost menu data (3b). Ship it as its own small PR.
2. §4.3: track the active window from **native** focus/blur, and treat the events as idempotent. Views do not report focus.
3. §4.6: route the Cmd-K menu command to the native-focused window, and drop it in the page if it comes within about 150 ms of a page Cmd-K. Confirm that Gloomberb's page-side shortcuts ignore `event.repeat`.
4. §4.3: restoring full screen straight after creating a window works as is.
5. **New risk:** windows on the second display creep upwards (1b). Before relying on per-machine frames (D2), confirm it with a follow-up run. If confirmed, correct it after creating a window: read the frame back and adjust once.
6. **New decision D10:** what closing main does when secondary windows are open.
