import { dom } from "../dom.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
const THROTTLE_MS = 250;
const typing = new Map();
let lastSent = { words: -1, at: 0 };
function wordCount(t) {
  const s = String(t || "").trim();
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}
function slotFor(name) {
  let s = state.slotOf ? state.slotOf(null, name) : 0;
  if (!s)
    state.roster.forEach((p) => {
      if (p.name === name) s = p.slot;
    });
  return s;
}
function render() {
  const c =
    dom.typingIndicators || document.getElementById("typing-indicators");
  if (!c) return;
  c.textContent = "";
  typing.forEach((e, name) => {
    if (name === state.profile.name) return;
    const r = document.createElement("div");
    r.className = "typing-indicator";
    const sl = slotFor(name);
    if (sl) r.style.color = `var(--p${sl})`;
    if (sl) r.style.setProperty("--slot", `var(--p${sl})`);
    r.textContent = `${name} is considering what to do (${e.words} words)`;
    c.appendChild(r);
  });
}
function clearOne(name) {
  typing.delete(name);
  render();
}
export function handleTyping(author, words) {
  const n = String(author || "").trim();
  const w = Math.max(0, Number(words) || 0);
  if (!n || n === state.profile.name) return;
  if (!w) {
    clearOne(n);
    return;
  }
  typing.set(n, { words: w });
  render();
}
export function clearTyping(author) {
  if (author) clearOne(author);
  else {
    typing.clear();
    render();
  }
}
export function syncReadyClear() {
  let c = false;
  typing.forEach((_, name) => {
    let rd = false;
    state.roster.forEach((p) => {
      if (p.name === name) rd = !!p.ready;
    });
    if (rd) {
      typing.delete(name);
      c = true;
    }
  });
  if (c) render();
}
export function notifyTyping() {
  const input = dom.turnInput || document.getElementById("turn-input");
  const w = input ? wordCount(input.value) : 0;
  const now = Date.now();
  if (w === lastSent.words && now - lastSent.at < THROTTLE_MS) return;
  lastSent = { words: w, at: now };
  if (network.isHost) {
    if (!state.isAdmin) handleTyping(state.profile.name, w);
    broadcast({ type: "typing", author: state.profile.name, words: w });
    return;
  }
  sendUpstream({ type: "typing", words: w });
}
export function wordCountOf(t) {
  return wordCount(t);
}
