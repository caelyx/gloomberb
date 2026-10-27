# Design: secondary desktop windows with a full multi-pane grid

Status: agreed design (decisions in §8), not yet built. Written from a reading of the code in October 2026, with a macOS spike (§6a) run before building; `path:line` references are as of that reading and will drift. Phases are delivered as separate pull requests (§5).

## 1. Goal and scope

- The macOS desktop app (Electrobun) can show one or more **secondary windows**. Each has its own dock grid and its own floating panes, and can run full screen on another display.
- Panes move between windows **by command**, for example "Move to ▸ Main window / Window 2 / New window". Dragging a pane between windows is out of scope; it is a possible later phase.
- **Cmd-K and backtick work in whichever window has focus.** A pane they open lands in that window, placed relative to that window's focused pane.
- Out of scope: the terminal (OpenTUI) renderer gets no multi-window UI. It only has to keep secondary-window data safe (§4.8).
- Today's single-pane **pop-out windows stay as they are** in v1. Merging the two concepts later is discussed in §8.

## 2. What the code does today (the constraints that shape the design)

1. **The main webview is the only real writer of layout and focus.**
   - It pushes a whole snapshot on every change, with a revision counter it owns (`src/state/app/context/index.tsx:576-601`).
   - Bun accepts it wholesale, keeping only detached-window frames (`src/renderers/electrobun/bun/desktop/workspace/index.ts:160-186`).
   - Detached windows may write only their own pane: `takeOwnPaneInstance` (`workspace/index.ts:190-204`) and `replaceDetachedPaneState` (`:205-220`).
   - Writes that Bun originates carry the old revision number and can be dropped by main (`index.tsx:557-563`). This is safe today only because detached windows never change layout structure.
2. **Window identity is the pane.**
   - RPC keys are `"main"` or `"detached:<paneInstanceId>"` (`bun/window/focus.ts:1-27`).
   - The window kind is the binary `"main" | "detached"` (`src/types/desktop-window.ts:25`, `bun/desktop/initialization.ts:32-53`).
   - That kind is checked in roughly a dozen files (`app.tsx`, `main.tsx`, `bridge.ts`, `global-shortcuts.ts`, `plugin-bindings.ts`, `runtime/{startup,update,desktop-menu,desktop-deeplink}.ts`, `window-controls.tsx`, …).
3. **There is one dock tree per layout tab.**
   - `LayoutConfig = {dockRoot, instances, floating, detached}` (`src/types/config.ts:132-137`).
   - Several functions rebuild the object from exactly those four keys, so a new key is **silently dropped**:
     - `normalizePaneLayout`, `cloneLayout` (`config.ts:806-936`)
     - `sanitizeLayout` (`src/data/config/layout.ts:283-311`)
   - The share format **rejects** any fifth key: `exactKeys` in `src/shares/portable-layout.ts:323`.
4. **The dock-tree primitives are pure and reusable** (`src/layout/pane-manager/dock-tree.ts:50-238`). The functions one level up (`docking.ts`, `queries.ts`, `layout-state.ts`) hard-code `layout.dockRoot`, but each is a thin wrapper, so adding a "which tree" argument is mechanical.
5. **The main `Shell` is close to parameterisable.**
   - Its children already take `layout` and `persistLayout` as arguments.
   - The parts still tied to the main window:
     - `layout = state.config.layout` (`shell/index.tsx:146`)
     - `persistLayout`, which replaces the whole `config.layout` (`:207-227`)
     - fullscreen/transient focus, which switches tabs (`:334-471`)
     - Move to New Layout, Pop Out, and the layout gallery
     - the dialog hosts mounted inside it (`:832-839`)
6. **Focus is per renderer and has no idea which window has focus.**
   - There is one `focusedPaneId` per webview.
   - `getPaneOrder` counts docked and floating panes only (`src/core/state/app/layout.ts:406-437`). Every hydrate in a detached window therefore resets its focus; it recovers only through the window-focus handler in `detached-pane-shell.tsx:107-133`.
   - **Bun does not track which window has focus.** There are no focus or blur listeners under `src/renderers/electrobun/bun/`.
7. **Cmd-K and backtick**
   - Cmd-K is a native menu accelerator (`bun/application-menu/index.ts:83`). Bun always sends it to main and **raises the main window first** (`bun/desktop/backend.ts:276-300`). The webview handlers for Cmd-K and backtick are disabled in detached windows (`src/app/global-shortcuts.ts:227-248`).
   - Pane opening runs through `placePaneInstance` (`src/app/pane-runtime/index.tsx:171-213`). It anchors on `spec.relativeToPaneId ?? focusedPaneId`. **`relativeToPaneId` exists but nothing sets it today**, which makes it a ready-made hook.
   - Roughly 140 pane types default to floating, so "open in the focused window" has to work for **floating panes too**, not just docked ones.
8. **The reuse rule is already cross-window.** If a matching pane exists anywhere, it is focused (and its OS window raised) rather than duplicated (`pane-reuse.ts:131-158`, `pane-runtime/index.tsx:158-169`).
9. **The terminal turns detached panes into floating ones** before state, and that converted config is then saved and synced (`src/app/app-bootstrap-state.ts:43-50`, `index.tsx:484-502`). Sync fingerprints already treat detached and floating as the same (`src/sync/core-contributors.ts:645-658`).

## 3. Core design decision: who writes the layout

**Recommendation (opinion): main stays the only writer. Secondary windows are shells that render a slice of state and send *intents* to main.**

- A secondary window renders from the snapshots Bun broadcasts, like detached windows do.
- It may edit **its own window's sub-layout** (split ratios, rearranging, floating rects, closing a pane) **optimistically** and send the result to main as `desktop.updateWindowLayout(windowId, {dockRoot, floating})`. Main splices it in, bumps its revision and broadcasts. This is the same "accept only your own slice" rule as `takeOwnPaneInstance` and `keepDetachedFrames`, widened from one pane to one window.
- Anything that **adds a pane or moves one across windows** runs in main:
  - opening from the command bar
  - moving a pane to another window
  - pinning or navigating a ticker
  - showing a pane

  The secondary window's plugin-registry calls (`createPaneFromTemplate(Async)`, `showPane`, `pinTicker`, `navigateTicker`, `focusPane`, `updateLayout`) **become proxies to main** instead of today's no-ops (`src/app/pane-runtime/plugin-bindings.ts:170-299`). Each carries `{targetWindowId, relativeToPaneId}`.
- Why: it keeps the single revision counter and avoids the last-writer-wins race (§2.1) with no new merge engine. The cost is one RPC hop on structural edits, which is acceptable for command-driven moves.
- **Alternative considered:** make the Bun workspace the layout authority. It is cleaner in the long run, but it means rewriting the main window's sync path and its undo (`layoutHistory` is per renderer). That is not justified for v1.
- **Reuse opportunity, to check before building a new channel:** Bun already forwards remote-control ops to main (`backend.ts:395-409`), and `src/remote/controller.ts` implements `pane.createFromTemplate`, `ticker.pin`, `layout.placePane` and so on. The intent channel could reuse that controller with an internal-only entry point, rather than inventing a parallel set of ops. Whether the remote schema's permission model (`local-write` and similar) fits internal use needs checking.

## 4. Workstreams

### 4.1 Data model (`src/types/config.ts` and friends)

- Add `LayoutConfig.windows?: SecondaryWindowLayout[]`, where `SecondaryWindowLayout = { id: string; dockRoot: DockLayoutNode | null; floating: FloatingPaneEntry[] }`.
  - `instances` stays shared; one list covers every window.
  - A pane is in exactly one place: main dock, main floating, detached, or one window's dock or floating.
- **Decision D1 – does a secondary window belong to a layout tab, or is it global?** Recommendation: **per tab**, inside `LayoutConfig`, because:
  - `detached` already works this way;
  - a tab then means "my whole two-screen arrangement";
  - tab switching, undo and saved layouts carry it for free.
  - Use **stable slot ids** (`"w2"`, `"w3"`) so that switching tabs reuses the open OS window instead of closing and reopening it.
- **Decision D2 – where window frames live.** Recommendation: **per machine, not in synced config.** Store them in `desktop-window.json` beside the main frame, as `{windows: {w2: {frame, fullscreen, maximized}}}`, using the existing fit-to-displays logic (`bun/window/remembered-frame.ts:76`). Display geometry is machine-specific, and the main frame already works this way. (Detached frames sync today; that is arguably a bug for multi-display, but it is out of scope.)
- Generalise the dock helpers that work on a whole layout:
  - add a tree selector, `"main" | windowId`, to `docking.ts`, `queries.ts` and `layout-state.ts` (`removeDockedLeaf`, `captureDockedMemory`);
  - `findPaneLocation(layout, id) → {window: "main"|id, kind: "docked"|"floating"|"detached"}` becomes the one place that answers "where is this pane".
- Cross-tree invariants:
  - `normalizePaneLayout` must dedupe across all trees, with priority main dock > window docks > floating > detached. Today `seenIds` only spans one tree.
  - `removePaneInstances`, `removeUnreachablePaneInstances` and `getPlacedPaneInstanceIds` must include window trees, or panes in windows get garbage-collected.
  - `cloneLayout` and `restoreHiddenPanes` (`hidden-panes.ts:143-159`) must carry `windows`.
  - `detachPane` (`layout-state.ts:139-147`) must also remove the pane from window trees.
- Placement memory: add `windowId?` to `DockedPlacementMemory` and `FloatingPlacementMemory`, so "dock back" and "move back" restore a pane to the right window.
- Focus resolution: `getPaneOrder` and `resolveFocusedPaneId` (`layout.ts:406-437`) take a window scope. Each renderer resolves focus over **its own window's** panes (this also fixes the detached-hydrate focus reset).
- Built-in layouts and builders that write `detached: []` need no change if `windows` is optional. Treat a missing value as `[]`.

### 4.2 Persistence, migration, sync

- `sanitizeLayout` (`src/data/config/layout.ts:283`): sanitise `windows` (ids, trees via the existing dock sanitiser, floating entries). Without this, `windows` is dropped on load and on save.
- Bump `CURRENT_CONFIG_VERSION` (currently 28). No data migration is needed for an optional field. Add one only if D5 (§8) converts existing detached entries.
- Sync (`src/sync/core-contributors.ts`):
  - `collectLayoutPayload` already pushes the whole layout.
  - `arrangedLayout` (`:645-658`) must include `windows` in the fingerprint, so terminal and desktop don't flap (see §4.8).

### 4.3 Bun host: window manager

- New `SecondaryWindowManager`, next to `DesktopDetachedWindowManager`:
  - RPC key `window:<id>`;
  - `reconcile()` driven by `config.layout.windows`;
  - per-window frame and fullscreen saved to `desktop-window.json`, restored at launch (`setFullScreen`). Generalise the single-window module state in `bun/index.ts:105-150` into a reusable "remembered window" helper.
- Extend `resolveWindowForRpcKey`, `windowForRpcKey` (`host-requests.ts:36-40`) and `normalizeInitWindowTarget` to a third kind: `"window"` with `windowId`.
- Init payload: `windowKind: "main" | "detached" | "window"`, plus `windowId`.
- **Active-window tracking (new):**
  - each view reports `window.focus` over RPC (`host.windowActivated`), the same event `DetachedPaneShell` already listens to;
  - Bun keeps `activeWindowKey`.
  - Check whether Electrobun has a native key-window event. I have not verified that it does. The view-reported route works either way.
- Menu routing (`backend.ts:276-300`):
  - `open-command-bar`, the `open-*-workflow` commands and "Search Ticker…" go to the **active** window's RPC and **stop raising main**;
  - quit, updates, devtools and the app badge stay main-only;
  - `useDesktopApplicationMenuRuntime` (`src/app/runtime/desktop-menu.ts:31`) subscribes in secondary windows too.
- **Decision D3 – closing a secondary window.** Recommendation: **dock its panes back into main** and remember their placement (`windowId`), so "reopen window" can restore them. The alternative is today's detached behaviour, which deletes the panes and would be destructive with several panes.
- Quit, restart, reset and import call `closeAll()` on the new manager as well (`backend.ts:302-331`).
- Plugin-disabled hiding: hide the pane **inside** its window, as the main shell does, rather than closing the window.

### 4.4 View: boot, chrome and Shell parameterisation

- `src/app.tsx:428-516`: a third branch for `kind === "window"` renders:
  - a **slim title strip** (drag region, traffic-light inset via `getTitlebarLeadingInset`, `WindowControls`), reusing the pieces `DetachedPaneShell` uses;
  - `Shell`;
  - `CommandBar`;
  - the dialog hosts.
  - No `Header` market summary, no `StatusBar` tab strip, no onboarding, no cloud sync, no session persistence.
  - **Decision D4:** does the secondary window get a status bar? Recommendation: a minimal footer showing only live/stale/error state, if the pane-conventions doc allows it; otherwise none.
- Turn the following into `Shell` props, taken today from `state.config.layout`:
  - `layout`: a synthetic `LayoutConfig` made from `{dockRoot, floating}` of the window plus the shared `instances`, with `detached: []`;
  - `persistLayout`: in main, the current behaviour; in a secondary window, it sends `updateWindowLayout`;
  - `mode: "main" | "secondary"`, which hides tab-switching fullscreen (or swaps it for a fullscreen that stays inside the window), Move to New Layout, Pop Out and the layout gallery.
- Snapshot filter: replace `detachedSnapshotKey` (`view/desktop/window/snapshot.ts:27-41`) with a window key covering:
  - that window's sub-layout;
  - its panes and their follow chains;
  - their paneState;
  - the global fields.
- Writes from a secondary window:
  - generalise `replaceDetachedPaneState` to a multi-pane `replaceWindowPaneState(windowId, partial)`;
  - generalise `replaceConfigFromDetachedPane` to accept the instance configs of panes in that window only (titles, settings).
  - Also fix the existing hazard where a stale non-layout config field (keybindings, recentCommands) from a secondary window overwrites main's: take only an allow-list of fields from secondary windows.
- Thread the new kind through every `isDetachedWindow` / `kind === "detached"` check (list in §2.2). Most of them want "not main" rather than "detached".
- Pane focus visuals: a pane shows as focused only when its window is the active window. This is the same rule `DetachedPaneShell` uses (`windowFocused && …`).

### 4.5 Commands that move panes between windows

- Pane menu and shortcut: **Move to ▸ Main window / Window 2 … / New window**. It runs in main as one layout op:
  1. Remove the pane from its source tree, capturing placement memory with `windowId`.
  2. Insert it into the target window, to the right of that window's last-focused pane, falling back to the root edge. Floating panes stay floating, with their rect scaled to the target window's size.
  3. Focus it, and raise the target window.
- Window-level commands (command bar and Window menu):
  - **New window**: an empty grid with the existing empty state; it opens on the next display if there is one.
  - **Move all panes to main and close window.**
  - **Focus window N.**
- Reuse the `movedFrom` / "Move Back" idea (`pane-layout-move.ts`): add a window variant, so a pane can be sent back to where it came from.
- Ticker links already work across windows at the data level (`binding.sourceInstanceId` lives in the shared `instances`). The link menu (`ticker-link-menu.ts`) needs to label sources by window ("AAPL chart · Window 2").

### 4.6 Cmd-K and backtick in the focused window

- `global-shortcuts.ts:227-248, 266-281`: allow `command-bar`, `ticker-search` and command chords in `kind === "window"`. Cmd-K also arrives from the native menu, which §4.3 routes to the active window.
- The `CommandBar` renders in the secondary window's webview, so the overlay appears on the right screen.
- Selecting an item calls the proxied registry methods (§3) with:
  - `targetWindowId`: this window;
  - `relativeToPaneId`: this window's `focusedPaneId`;
  - `termSize`: this window's size. `getTermSize()` is main's size today, and floating rects and edge anchors depend on it.
- Main's `placePaneInstance` (`pane-runtime/index.tsx:171-213`) and `placePinnedTickerTarget` (`ticker-open-runtime.ts:115-212`) gain a window target:
  - **docked:** insert into that window's tree, relative to `relativeToPaneId`, else at the bottom-right edge of that tree;
  - **floating:** into that window's floating list, centred in that window.
- Reuse rule (`pane-reuse.ts`, `ticker-navigation.ts:101-115`):
  - **Decision D6.** Recommendation: prefer a match **in the target window**; else focus the match in another window and raise that window (today's behaviour). Shift+Enter (`forceNewPane`) still forces a new pane.
- Ticker navigation (`plugin-bindings.ts:298-383`) and its "focus hasn't moved" checks use the window-local `focusedPaneId`.
- Enter on a list row that jumps to the row's Ticker Research follower (`resolveTickerActivation`) would move focus to another window if the follower lives there. That is acceptable, but it should raise that window rather than silently changing focus behind the current one.
- Deep links come from outside, so there is no meaningful "focused" window: send them to the **last active** window.

### 4.7 Remote control and CLI

- `src/remote/controller-utils.ts:72-99`: `panePlacement` reports `window:<id>`; mutation summaries list window panes.
- Add an optional `window` argument to `pane.show`, `pane.createFromTemplate`, `ticker.pin` and `layout.placePane`.
- `layout.setGrid`, `layout.focusRegion` and `layout.closeFloating` stay main-only. Document that.
- `gloomberb layout` (`src/cli/commands/system.ts:604`) prints a count of panes per window.

### 4.8 Sharing, marketplace and terminal

- **Shared layouts:**
  - for v1, `publishableLayout` (`portable-layout.ts:489-553`) **flattens** window panes into `floating` rects, the same idea as `arrangedLayout`, so the four-key format and older clients keep working;
  - a later schema v3 can carry windows properly.
- Marketplace previews and counts (`layout-marketplace/model.ts:60-143`, `geometry.ts`): count window panes; the preview can ignore window geometry.
- **Terminal:**
  - **Decision D7.** Recommendation: the terminal leaves `windows` **untouched and not drawn**, rather than turning them into floating panes the way detached panes are. That conversion is persisted and synced (§2.9), which would destroy the desktop's arrangement.
  - Window panes still count as placed, so they are not garbage-collected.
  - The cost: those panes are invisible in the terminal. A command such as "Bring window panes here" could be added later.

### 4.9 Docs

- A section in `docs/` (pane conventions and/or the user docs) on windows:
  - what moves with tabs;
  - what closing a window does;
  - how Cmd-K targets the focused window.
- AGENTS.md says methodology and usage explanations belong in docs, not in pane text.

## 5. Suggested phases (each one shippable)

| Phase | Content | Visible result |
|---|---|---|
| 1 | §4.1 model and helpers, §4.2 persistence and sync, §4.8 terminal and sharing safety | None. Configs with `windows` round-trip safely everywhere. |
| 2 | §4.3 window manager, frames, third window kind; §4.4 boot, chrome and a **read-only** grid | "New window" shows panes placed there by a debug or remote op, on screen 2, full screen, restored at launch. |
| 3 | §4.4 edit path (`updateWindowLayout`, multi-pane state and instance writes), window-local focus | Resize, rearrange and close panes inside window 2. |
| 4 | §4.5 move commands, close-window behaviour (D3) | The core feature: build a second-screen grid by command. |
| 5 | §4.3 active-window tracking and menu routing; §4.6 command bar, backtick, proxied opening | Cmd-K and backtick open panes in the focused window. |
| 6 | §4.7 remote and CLI, link-menu labels, §4.9 docs | Polish. |

Phases 1–4 deliver something usable (panes moved by command). Phase 5 is the "open where I am" behaviour. If needed, Phase 5 could ship before 3; a read-only window plus commands is already useful.

**Delivered so far:** phase 1 (#15), phase 2 (#16) and phase 3 (#17). The order from here is 5, then 4.

**Phase 3 as built:**
- **Intents to main.** A secondary window edits its own view at once and sends `window.intent` requests. The host names the sending window and passes them to the main window, which applies them (`applyWindowIntent`):
  - `editLayout`: the window's grid and its own pane instances (titles, settings, links). It is refused if the window's panes changed since the edit was made, or if it places a pane that isn't the window's. A pane the edit no longer places was closed and leaves the layout.
  - `replacePaneState`: the window's own panes only.
  - `setPluginConfig`: plugin settings a pane changed, by plugin.
- **Undo.** A grid edit joins the main window's undo history, so Cmd-Z in the main window can undo it. There is no undo in a secondary window (D8).
- **Unanswered changes.** `SecondaryWindowSync` keeps them over snapshots sent before the main window applied them. A refused change brings the main window's state back.
- **Focus.** Each window keeps its own focused pane. Only the window with native focus, or the last one to have it, draws its focused pane as focused.
- **Moves stay with the host.** Phase 2's moves (to a new window, back to main, closing a window) are still host workspace operations, with the same race Pop Out has.

**Phase 5 as built:**
- **Bar in each window.** A secondary window mounts its own command bar. Cmd-K, backtick and command chords work there, as in the main window; a popped-out pane still has none.
- **Menu routing.** The menu's Open Command Bar and Search Ticker go to the secondary window last in front (`commandBarMenuTarget`), and no longer raise main. Forms (`open-*-workflow`) still open in main, because they submit through its state.
- **Cmd-K echo.** One press reaches the view as the menu accelerator and as a keydown. `createMenuEchoGate` drops whichever arrives second within 150 ms, and the menu's open is a no-op while the bar is already open, so the keydown alone closes it.
- **Opening panes locally, not by proxy.** A secondary window's state is a view with its own grid in the main window's place, so the existing placement code (`placePaneInstance`, ticker pinning, the ticker inspector) already places relative to that window's focused pane and sizes floating panes to that window. The new pane reaches main through phase 3's `editLayout`, which now accepts an instance the layout does not hold yet.
- **Reuse (D6).** `findReusablePaneInstance` (`preferPaneIds`) and `findFixedTickerPaneForSymbol` prefer a match in the asking window. A match elsewhere is focused through `window.focusPane`: the host brings that window forward and tells it to focus the pane.
- **Not moved:** deep links and remote control still go to main. A secondary window drops layout-tab actions (switching, new, delete, undo and so on) from its bar, and settings changed from its bar other than plugin settings don't persist.

**Effort (opinion, not measured):** the biggest pieces are Phase 1 (many small edits across about 25 files, plus tests) and Phase 3 (state plumbing). Phases 2 and 5 are moderate. Phase 4 is small once 1 and 3 exist. I would not trust a number in days without first prototyping Phase 2. The likely surprises are in Shell assumptions not covered above, and in Electrobun's multi-window behaviour on macOS (fullscreen Spaces, key-window events).

## 6. Tests (per CONTRIBUTING's selective policy)

Worth adding, because each is complex and easy to break:
- Cross-tree `normalizePaneLayout`: a pane is in exactly one place; duplicates resolved by priority; garbage collection does not eat window panes.
- `sanitizeLayout` round-trip with `windows`, and that `cloneLayout` and `restoreHiddenPanes` preserve it.
- The move-between-windows op, including placement memory and Move Back.
- Workspace splice rules: a secondary window may change only its own sub-layout, its own panes' state and instance configs, and the allow-listed fields.
- Sync fingerprint stability across terminal and desktop with windows present.
- Publish flattening keeps the four-key format.
- Placement with a window target: docked relative to the focused pane, floating centred in the target size.
- Menu routing to the active window: a unit test on the Bun side using the key and RPC registry.

Not worth adding: chrome rendering, prop wiring, menu labels.

Manual verification on a real Mac with two displays is unavoidable for Phases 2 and 5: full-screen Spaces, restore at launch, and Cmd-K routing. Existing terminal behaviour should get a tmux pass once Phase 1 lands, per the `tui-testing` skill.

## 6a. Spike results (run 1, 2026-10-19)

Full write-up: `spikes/multi-window/results/RESULTS.md` on the `spike/multi-window` branch (not merged).

- **Full screen per display, and restore at launch: works.** Both windows were full screen at once, on the correct displays, and came back that way after quitting and relaunching.
- **Focus:** Electrobun's native `focus`/`blur` events are reliable and arrive first. Page focus events were missed many times. → §4.3 uses native events only.
- **Cmd-K:** routing to the focused window works, and main is not raised. It **fires twice**, through the menu and as a page key press. → Ignore a menu Cmd-K that arrives within about 150 ms of a page Cmd-K.
- **Prerequisite (bug, fixed in #13):** Electrobun 1.18.1 deletes a menu item's `data` after its first click, so each Gloomberb menu command worked only once per launch. Commands now ride in the menu `action` string.
- **Window creep on the second display (cause found, fixed in #16).** Electrobun 1.18.1 on macOS flips y against two different heights:
  - window creation, and the move and resize events, use the primary display's height;
  - `setFrame`, `setPosition` and `getFrame` use the height of the display the window is on (`[window screen]`).

  On a display 108 pt shorter than the primary, `getFrame` reads 108 too high and `setFrame` lands 108 too low. Gloomberb saves frames from the events, which are correct, and moves windows through `window/native-frame.ts`, which compensates.
- **New decision D10:** closing main while secondary windows are open. Recommendation: quit the app.

## 7. Risks and unknowns

- **Electrobun multi-window behaviour on macOS** (unverified): native fullscreen per window, a key-window/focus event, and whether a Cmd-K menu accelerator also produces a webview keydown. These are worth a one-day spike before Phase 2.
- **Shell's hidden main-window assumptions.** The investigation found the main ones (§2.5), but `pluginRegistry.bindHost` registers per-renderer singletons from the Shell. That is fine with one Shell per webview; it must stay that way.
- **Last-writer-wins on non-layout config fields** from secondary windows exists today in milder form. The allow-list in §4.4 fixes it, but it needs care so that legitimate global settings changed from window 2, such as theme, still apply.
- **Undo** is per renderer and per tab. Undo in window 2 would undo main's history unless scoped. Simplest v1: undo only in main, or undo scoped to the window's own sub-layout edits.
- **Plugin APIs** written against "the layout" (`pluginRegistry.updateLayout`) see the main tree only. External plugins could misbehave with window panes. Check `PLUGINS.md` and decide whether the plugin API exposes windows or keeps them invisible.

## 8. Decisions (agreed 2026-10-19)

All were agreed as recommended below.

| # | Decision | Agreed |
|---|---|---|
| D1 | Windows per layout tab, or global | Per tab, with stable slot ids |
| D2 | Window frames synced, or per machine | Per machine (`desktop-window.json`) |
| D3 | Closing a window | Dock its panes back into main, remembered |
| D4 | Status bar in secondary windows | Minimal status-only footer, or none |
| D5 | Merge single-pane pop-outs into windows | Not in v1. Revisit after Phase 4: a pop-out could become a one-pane window, removing a whole code path (`detached-windows.ts`, `DetachedPaneShell`, the `detached` layout field). |
| D6 | Reuse rule when a matching pane is in another window | Prefer the focused window, else focus and raise the other |
| D7 | Terminal handling of windows | Preserve, don't draw, don't convert |
| D8 | Undo in secondary windows | Main-only in v1 |
| D9 | Plugin API visibility of windows | Invisible in v1; window panes act as "in the layout" |
| D10 | Closing main while secondary windows are open | Quit the app (main owns the state). Raised by the spike; agreed 2026-10-19. |
