import { Electroview } from "electrobun/view";
import type { HostState, SpikeRpcSchema, WindowKey } from "../shared/rpc";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let me: WindowKey | null = null;
const counts = { menuK: 0, domK: 0, domTick: 0, menuTick: 0, deduped: 0, repeats: 0 };

// Run 2: the proposed fix for Cmd-K firing twice. One press reaches the page both as a menu
// accelerator and as a keydown, 0–6 ms apart in run 1; whichever comes second within this
// window is dropped. A mouse click on the menu item has no keydown, so it always gets through.
const CMD_K_DEDUPE_MS = 150;
let lastMenuCmdK = -Infinity;
let lastDomCmdK = -Infinity;

const rpc = Electroview.defineRPC<SpikeRpcSchema>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {},
    messages: {
      menuCommand: ({ command, nativeActive }) => {
        if (command === "command-bar") {
          const now = performance.now();
          lastMenuCmdK = now;
          if (now - lastDomCmdK < CMD_K_DEDUPE_MS) {
            counts.deduped += 1;
            sendLog("menu-cmd-k-deduped", { msSinceDomCmdK: Math.round(now - lastDomCmdK) });
            renderCounts();
            return;
          }
          counts.menuK += 1;
          toggleBar(`menu accelerator (host thought key window = ${nativeActive ?? "none"})`);
        } else {
          counts.menuTick += 1;
          openBar(`menu: Search Ticker (host thought key window = ${nativeActive ?? "none"})`);
        }
        renderCounts();
      },
      hostState: (state) => renderState(state),
      hostLog: ({ line }) => appendLog(line),
    },
  },
});
new Electroview({ rpc });

function sendLog(event: string, detail?: unknown): void {
  rpc.send.log({ event, detail });
}

// ---- fake command bar ------------------------------------------------------

function openBar(source: string): void {
  $("overlay").classList.add("open");
  $("bar-src").textContent = `Opened by: ${source}`;
  $<HTMLInputElement>("bar-input").focus();
  sendLog("bar-open", { source });
}
function closeBar(reason: string): void {
  if (!$("overlay").classList.contains("open")) return;
  $("overlay").classList.remove("open");
  sendLog("bar-close", { reason });
}
function toggleBar(source: string): void {
  if ($("overlay").classList.contains("open")) closeBar(`toggled by ${source}`);
  else openBar(source);
}

// ---- keys ------------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  const typingTarget = event.target instanceof HTMLInputElement && event.target.id === "typing";
  if (event.key === "k" && event.metaKey) {
    if (event.repeat) {
      // Gloomberb's page shortcuts already run once per press (src/app/global-shortcuts.ts).
      counts.repeats += 1;
      renderCounts();
      return;
    }
    const now = performance.now();
    lastDomCmdK = now;
    if (now - lastMenuCmdK < CMD_K_DEDUPE_MS) {
      counts.deduped += 1;
      sendLog("dom-cmd-k-deduped", { msSinceMenuCmdK: Math.round(now - lastMenuCmdK) });
      renderCounts();
      return;
    }
    counts.domK += 1;
    sendLog("dom-keydown-cmd-k", { defaultPrevented: event.defaultPrevented });
    toggleBar("DOM keydown Cmd-K");
    renderCounts();
    return;
  }
  if (event.key === "`" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (typingTarget) {
      sendLog("dom-keydown-backtick-in-input", {});
      return; // must type the character, like Gloomberb's text fields
    }
    counts.domTick += 1;
    event.preventDefault();
    sendLog("dom-keydown-backtick", {});
    openBar("DOM keydown backtick");
    renderCounts();
    return;
  }
  if (event.key === "Escape") closeBar("Escape");
}, true);

// ---- focus reporting -------------------------------------------------------

window.addEventListener("focus", () => { rpc.send.domFocus({ focused: true }); });
window.addEventListener("blur", () => { rpc.send.domFocus({ focused: false }); });

// ---- buttons ---------------------------------------------------------------

$("fs-on").addEventListener("click", () => { void rpc.request.setFullScreen({ fullScreen: true }); });
$("fs-off").addEventListener("click", () => { void rpc.request.setFullScreen({ fullScreen: false }); });
$("activate-other").addEventListener("click", () => { void rpc.request.activateOther({}); });
$("open-w2").addEventListener("click", () => { void rpc.request.openWindow2({}); });
$("close-self").addEventListener("click", () => { void rpc.request.closeSelf({}); });

// ---- rendering -------------------------------------------------------------

function renderCounts(): void {
  $("c-menu-k").textContent = String(counts.menuK);
  $("c-dom-k").textContent = String(counts.domK);
  $("c-dom-tick").textContent = String(counts.domTick);
  $("c-menu-tick").textContent = String(counts.menuTick);
  $("c-deduped").textContent = String(counts.deduped);
  $("c-repeats").textContent = String(counts.repeats);
}

const rect = (r: { x: number; y: number; width: number; height: number } | null) =>
  r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}` : "–";

function renderState(state: HostState): void {
  $("native-badge").classList.toggle("on", state.nativeActive === me);
  $("dom-badge").classList.toggle("on", state.domActive === me);
  const mine = state.windows.find((w) => w.key === me);
  $("fs-badge").classList.toggle("on", !!mine?.fullscreen);

  $("windows").innerHTML = state.windows.map((w) =>
    `<tr><td>${w.key}${w.key === me ? " (this)" : ""}</td><td>${w.displayId ?? "–"}</td><td>${w.fullscreen ? "yes" : "no"}</td><td>${rect(w.frame)}</td></tr>`).join("");
  $("displays").innerHTML = state.displays.map((d) =>
    `<tr><td>${d.id}</td><td>${d.isPrimary ? "yes" : ""}</td><td>${rect(d.bounds)}</td><td>${d.scaleFactor}</td></tr>`).join("");

  const buttons = $("display-buttons");
  buttons.innerHTML = "";
  for (const d of state.displays) {
    const button = document.createElement("button");
    button.textContent = `Move this window to display ${d.id}${d.isPrimary ? " (primary)" : ""}`;
    button.addEventListener("click", () => { void rpc.request.moveToDisplay({ displayId: d.id }); });
    buttons.append(button);
  }
}

function appendLog(line: string): void {
  const log = $("log");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.textContent += `${line}\n`;
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// ---- boot ------------------------------------------------------------------

void (async () => {
  me = (await rpc.request.whoami({})).key;
  $("who").textContent = me === "main" ? "MAIN window" : "WINDOW 2";
  document.title = me === "main" ? "Spike – main" : "Spike – window 2";
  renderCounts();
  renderState(await rpc.request.hostState({}));
  if (document.hasFocus()) rpc.send.domFocus({ focused: true });
})();
