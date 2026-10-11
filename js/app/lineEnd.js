import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
let active = false;
function render() {
  const log = document.getElementById("turn-builder-log");
  if (!log) return;
  const ex = log.querySelector(".turn-line-end");
  if (ex) ex.remove();
  if (!active) return;
  const m = document.createElement("div");
  m.className = "turn-line-end";
  m.setAttribute("role", "separator");
  m.textContent =
    "A turn is cooking. Any plans beyond this line won't make it.";
  const last = log.querySelector(".turn-entry:last-of-type");
  if (last) last.after(m);
  else log.appendChild(m);
}
// re-insert after log mutations so ready toggle or new turns don't wipe it
let _obs = null;
function ensureObserver() {
  const log = document.getElementById("turn-builder-log");
  if (!log || _obs) return;
  _obs = new MutationObserver(() => {
    if (active && !log.querySelector(".turn-line-end")) render();
  });
  _obs.observe(log, { childList: true });
}
function syncBtn() {
  const b = document.getElementById("line-end-button");
  if (!b) return;
  b.hidden = !state.isAdmin;
  b.setAttribute("aria-pressed", active ? "true" : "false");
  b.classList.toggle("is-active", active);
}
export function toggleLineEnd() {
  if (!state.isAdmin) return;
  active = !active;
  render();
  syncBtn();
  if (network.isHost) broadcast({ type: "line-end", active });
  else sendUpstream({ type: "line-end", active });
}
export function clearLineEnd() {
  if (!active) return;
  active = false;
  render();
  syncBtn();
  if (network.isHost) broadcast({ type: "line-end", active: false });
  else if (state.isAdmin) sendUpstream({ type: "line-end", active: false });
}
export function setLineEnd(v) {
  active = !!v;
  render();
  syncBtn();
}
export function refreshLineEndButton() {
  syncBtn();
  ensureObserver();
}
export function ensureLineEnd() {
  if (active) render();
  ensureObserver();
}
