# Multi-window spike (macOS)

This is a throwaway Electrobun app. It checks the macOS behaviours the secondary-window plan depends on, before any work happens in Gloomberb itself. It uses the same Electrobun version as Gloomberb (1.18.1), and the same title-bar style (`hiddenInset`) and native renderer. Gloomberb's patch to Electrobun only adds a Windows icon, so it is not applied here.

It opens two windows, **MAIN** and **WINDOW 2**. Window 2 opens on your second display if one is connected. Each window shows:
- which window the app believes has focus, according to the native macOS event and according to the page;
- full-screen state;
- counters for every route by which a command bar can open;
- a live event log.

The same log is written to `~/gloomberb-multi-window-spike.log` (JSON lines). Window frames are saved to `~/gloomberb-multi-window-spike-frames.json`.

## What it answers

| # | Question | The plan depends on it for |
|---|---|---|
| Q1 | Can each window go native full screen on its own display, and be restored that way at launch? | §4.3 window manager, D2 per-machine frames |
| Q2 | Do Electrobun's native `focus`/`blur` window events track the key window reliably? How do they compare with page focus? | §4.3 active-window tracking |
| Q3 | Can Cmd-K (a menu accelerator) be routed to the focused window without raising main? Does the page *also* get the keydown, so it fires twice? | §4.3 menu routing, §4.6 |
| Q4 | Does backtick reach the page in every window, while still typing normally in text fields? | §4.6 |
| Q5 | What happens when you close window 2, reopen it, or close main? | §4.3, D3 |

Electrobun 1.18.1 does expose per-window `focus`, `blur` and `keyDown` events and `Screen.getAllDisplays()`. I read this in its source; it has not been verified on a Mac. Q2 is about whether those events behave.

## Setup

Requirements: a Mac with **two displays**, and Bun installed. Note which display is your primary (the one with the menu bar).

1. In **System Settings → Desktop & Dock → Mission Control**, record whether **"Displays have separate Spaces"** is on. It changes full-screen behaviour on multiple displays; with it off, a full-screen window takes over its display differently. Leave it **on** for the main run.
2. Delete any earlier results:
   `rm -f ~/gloomberb-multi-window-spike.log ~/gloomberb-multi-window-spike-frames.json`
3. Start the spike:
   ```sh
   cd spikes/multi-window
   bun install
   bun run dev
   ```
   `electrobun dev` builds an unsigned app and launches it. The first run may download Electrobun's native binaries. I could not run this step here (Linux container), so if it fails, send me the error output.

## Checklist

For each step, record what happened in the Result column. The Expected column is what the plan **hopes** for; it is not a prediction. "Log" means the event-log panel or the log file.

### A. Displays and placement (Q1)

| #  | Do this                                                                                   | Expected (hoped)                                                                                                     | Result |
|----|-------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|--------|
| A1 | Launch.                                                                                   | Both windows open. Window 2 is on the second display. The Displays table lists both, with sensible bounds and scale. | Yes.   |
| A2 | In window 2, click **Move this window to display …** for each display in turn.            | The window moves. The Windows table shows the new display id.                                                        | Yes    |
| A3 | Drag window 2 by its top strip (to the right of the traffic lights) to the other display. | The window drags. `frames-saved` appears in the log.                                                                 | yes    |

### B. Full screen per display (Q1)

| #  | Do this                                                                                                                     | Expected (hoped)                                                                                                                                                                                  | Result |
|----|-----------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| B1 | Put main on display 1 and window 2 on display 2. Focus main and press the green button (or **Window → Enter Full Screen**). | Main goes full screen on display 1 only. Window 2 stays usable on display 2. The full-screen badge lights in main.                                                                                | Yes    |
| B2 | Focus window 2 and make it full screen too.                                                                                 | Both windows are full screen at once, each on its own display.                                                                                                                                    | Yes    |
| B3 | Check the `resize-settled` / `fullscreen-check` lines.                                                                      | `isFullScreen: true` for both windows within 1 second.                                                                                                                                                                                                                                                |        |
| B4 | Exit full screen in window 2 using the **Exit full screen (API)** button. Re-enter with **Enter full screen (API)**.        | The API calls behave the same as the green button.                                                                                                                                                                                                                                                                                                                                                               | Yes    |
| B5 | With both windows full screen, quit with **Cmd-Q**. Relaunch with `bun run dev`.                                            | Both windows reopen full screen, each on its original display. In the log, `restore-fullscreen-immediate` is followed by `fullscreen-check` with `isFullScreen: true` at 1 s and/or 3 s.                                                                                                                                                                                                                | Yes    |
| B6 | If B5 failed: record **which** part failed (wrong display, not full screen, full screen on the wrong display, flicker).     | —                                                                                                                                                                                                 |        |
| B7 | Quit with both windows **not** full screen, but each on a different display. Relaunch.                                      | Each reopens on the same display, at the same size.                                                                                                                                               |        |

### C. Focus tracking (Q2)

| #  | Do this                                                                                                                      | Expected (hoped)                                                                                                                                                                                          | Result |
|----|------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| C1 | Click back and forth between the two windows about 5 times.                                                                  | Both green badges ("native: key window" and "DOM: focused") move together to the clicked window every time. Each click logs one `native-blur`, one `native-focus` and the matching `dom-*` events. | Yes    |
| C2 | Press **Cmd-`** (the macOS "next window" shortcut) a few times.                                                              | Focus cycles between the windows. Badges and log follow. No command bar opens.                                                                                                                            | Yes    |
| C3 | Switch to another app (Cmd-Tab), then back.                                                                                  | When you leave, both badges go off. When you come back, the window that was last focused gets them.                                                                                                                                                                                         | Yes    |
| C4 | With both windows full screen, move between them by clicking on each display, and by switching Spaces (Ctrl-←/→ or a swipe). | The badges follow the visible window you interact with.                                                                                                                                                                                                                                     |        |
| C5 | Look at the order of `native-focus` and `dom-focus` lines in C1–C4.                                                          | Record whether the native event always arrives, and whether it comes before or after the page's.                                                                                                          |        |

### D. Cmd-K routing (Q3)

| #  | Do this                                                                             | Expected (hoped)                                                                                                                                                                 | Result                                                                                                  |
|----|-------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| D1 | Focus **window 2** (click the page body, not the text field). Press **Cmd-K** once. | The fake command bar opens **in window 2**. Main is **not** brought forward. `menu-routed` shows `target: "w2"` via `native-focus`.                                              | Yes                                                                                                     |
| D2 | Read window 2's counters after D1.                                                  | Either "via menu" = 1 and "via DOM keydown" = 0, or the reverse. **If both are 1**, the shortcut fires twice and the bar opens then closes immediately. Record which happened. | The first time, it opened quickly and then closed; the second time I did it, it opened and stayed open. |
| D3 | Repeat D1 and D2 in **main**.                                                       | Same as window 2.                                                                                                                                                                | It just opened once and stayed open, as intended.                                                       |
| D4 | Click into the **typing** field in window 2, then press Cmd-K.                      | Record whether the menu route still fires while a text field has focus.                                                                                                          | Yes                                                                                                     |
| D5 | Hold Cmd-K for about a second in window 2.                                          | Count the `menu-clicked` lines. Gloomberb already suppresses repeats while the key is held; this checks the spike sees the same repeats.                                         |                                                                                                         |
| D6 | Click into main, then **immediately** press Cmd-K. Repeat a few times.              | The bar always opens in main. There's no race where it opens in the window that was focused before.                                                                                                        |                                                                                                         |
| D7 | Use the mouse: **View → Open Command Bar** while window 2 is focused.               | It opens in window 2. A menu click does not change which window is focused.                                                                                                                                                                                              | No reaction; no command bar opened. Checked and it doesn't work in window 1 either.                     |

### E. Backtick (Q4)

| #  | Do this                                                         | Expected (hoped)                                          | Result |
|----|-----------------------------------------------------------------|-----------------------------------------------------------|--------|
| E1 | In each window, click the page body and press **`** (backtick). | The bar opens in that window. "Backtick via DOM" goes up. | Yes    |
| E2 | Click into the **typing** field and press backtick.             | The character is typed. The bar does not open.            | Yes    |
| E3 | Mouse: **File → Search Ticker…** while window 2 is focused.     | It opens in window 2. "Search Ticker via menu" goes up.   | Yes    |

### F. Window lifecycle (Q5)

| #  | Do this                                                    | Expected (hoped)                                                                                                                                                                                                                           | Result                                                                                             |
|----|------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| F1 | Close window 2 with its red button.                        | The app keeps running. `window-closed` for w2 appears in the log.                                                                                                                                                                          | Yes                                                                                                |
| F2 | **File → Open Window 2** (Cmd-Shift-N).                    | Window 2 reopens at its remembered frame and display. Record whether it is full screen if it was full screen when you closed it. (The spike only restores full screen at launch, so "not full screen" here is expected; record it anyway.) | Yes -- not full screen                                                                             |
| F3 | Make window 2 full screen, then close it with Cmd-W.       | Record what macOS does: the Space closes, and focus goes to …?                                                                                                                                                                             | Nothing happens; CMD-W just causes the system to give the "boop" error sound, and nothing changes. |
| F4 | Close **main** with its red button while window 2 is open. | Record whether the app keeps running with only window 2 open. (In Gloomberb, I found no handler that quits when main's native red button is used; only its own close control does. So this shows Electrobun's baseline.)                | Main window closes, window two remains open and fullscreen.                                        |

### G. Optional: "Displays have separate Spaces" off

Only if you're willing to log out and back in, since macOS needs that for this setting to take effect. Repeat B1, B2 and C4 with the setting **off**, and record the differences.

## What to send back

1. The filled-in checklist. Short notes are fine, e.g. "D2: both = 1, flickers".
2. `~/gloomberb-multi-window-spike.log`
3. Your macOS version, your display set-up (e.g. "MacBook Pro built-in + 27-inch external, external is primary"), and the "separate Spaces" setting.

## Clean-up

`rm -f ~/gloomberb-multi-window-spike.log ~/gloomberb-multi-window-spike-frames.json`. The built app is in `spikes/multi-window/build/`; delete the folder when you're done. This spike is not meant to be merged.
