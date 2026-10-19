# Spike run 2: short follow-up (about 10 minutes)

Run 1's results are in `results/RESULTS.md`. This run checks three things before phase 2 depends on them:
- why window 2 **creeps up** the second display, and whether one correction step fixes it;
- the proposed fix for **Cmd-K firing twice**;
- two checks run 1 skipped (C4 and D6).

What changed in the spike since run 1:
- Menu commands now ride in the action string, like Gloomberb after #13, so every menu item works on every click.
- After every window placement, the window's frame is read back and logged as `frame-readback`.
- Cmd-K duplicates within 150 ms are dropped, and held-key repeats are ignored. New counters show both.

## Setup

```sh
git fetch origin spike/multi-window && git checkout spike/multi-window && git pull
cd spikes/multi-window
rm -f ~/gloomberb-multi-window-spike.log ~/gloomberb-multi-window-spike-frames.json
```

Use the same displays and settings as run 1.

## Checks

Record a short result for each check. The log file holds most of the detail, so a one-line note is enough.

| # | Do this | What to look for | Result |
|---|---|---|---|
| R1 | `bun run dev`. Leave both windows where they open. Quit (Cmd-Q). Relaunch and quit **three more times**, without touching the windows. | Does window 2 visibly move up the LG display on each launch? Does main stay put? | |
| R2 | Drag window 2 to the middle of the LG display. Quit. Relaunch and quit twice. | Same question, from a position away from the top of the display. | |
| R3 | `rm -f ~/gloomberb-multi-window-spike-frames.json`, then repeat R1 using **`SPIKE_CORRECT_FRAMES=1 bun run dev`** each time. | Does window 2 now stay put across relaunches? Is there a visible jump just after it opens? | |
| R4 | In window 2, click **Move this window to display …** for each display, there and back twice. | Nothing to judge by eye; the log records it. | |
| R5 | Focus window 2 (click the page body). Press Cmd-K five times, about a second apart. | The bar opens, then closes, then opens, and so on, **with no flicker**. "Cmd-K duplicates dropped" goes up by 1 per press. | |
| R6 | With the mouse, click **View → Open Command Bar**, press Esc, then click it again. Do the same in main. | The bar opens every time. Run 1 failed this because of the menu bug. | |
| R7 | Make both windows full screen. Move between them by clicking on each display, then by switching Spaces (Ctrl-← / Ctrl-→ or a swipe). | The two green badges follow the window you're using. This is run 1's C4. | |
| R8 | Click into main and **immediately** press Cmd-K. Then do the same in window 2. Alternate about 5 times. | The bar always opens in the window you just clicked. This is run 1's D6. | |

Skip holding Cmd-K down. Gloomberb already runs a held shortcut only once, both in the page (`src/app/global-shortcuts.ts`) and in the menu, so a held-key test here would only measure the spike's own simpler code.

## Send back

- Your notes for R1–R8.
- `~/gloomberb-multi-window-spike.log`
- `~/gloomberb-multi-window-spike-frames.json`
