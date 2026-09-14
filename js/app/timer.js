/* js/app/timer.js */

/* The administrateur's countdown: armed in seconds from the Timer dialog, then
   emptied second by second under the turn-builder title and chimed at zero. */

import { network, broadcast, sendUpstream } from "./net.js";
import { state } from "./state.js";
import * as volume from "../audio/volume.js";

const CHIME_URL = "sounds/exp-gained.wav";
const MAX_SECONDS = 3600;

let endAt = 0;
let totalMs = 0;
let ticker = null;
let chime = null;

function el(id) {
  return document.getElementById(id);
}

function parts() {
  const bar = el("timer-bar");
  const fill = el("timer-bar-fill");
  const text = el("timer-bar-text");
  return bar && fill && text ? { bar, fill, text } : null;
}

function playChime() {
  try {
    if (!chime) chime = new Audio(CHIME_URL);
    const levels = volume.all ? volume.all() : null;
    if (levels) chime.volume = Math.max(0, Math.min(1, levels.master * levels.sfx));
    chime.currentTime = 0;
    const played = chime.play();
    if (played && typeof played.catch === "function") played.catch(() => {});
  } catch (error) {}
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/* Read off the clock rather than counted down, so a throttled tab cannot let
   the bar run long. */
function tick() {
  const held = parts();
  if (!held) {
    stopTicker();
    return;
  }

  const remainingMs = Math.max(0, endAt - Date.now());
  held.text.textContent = String(Math.ceil(remainingMs / 1000));
  held.fill.style.transition = "width 1s linear";
  held.fill.style.width = (remainingMs / totalMs) * 100 + "%";

  if (remainingMs > 0) return;

  stopTicker();
  playChime();
  setTimeout(() => {
    const still = parts();
    if (still) still.bar.hidden = true;
  }, 1000);
}

/* Every seat's side of it: the seconds that arrived, counting from now. */
export function setTimer(rawSeconds) {
  stopTicker();
  const held = parts();
  if (!held) return;

  const seconds = Math.floor(Number(rawSeconds));
  if (!isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    held.bar.hidden = true;
    return;
  }

  totalMs = seconds * 1000;
  endAt = Date.now() + totalMs;
  held.bar.hidden = false;
  held.fill.style.transition = "none";
  held.fill.style.width = "100%";
  tick();
  ticker = setInterval(tick, 1000);
}

export function resetTimer() {
  stopTicker();
  const held = parts();
  if (held) held.bar.hidden = true;
}

/* Host only: the bar is armed here, then the table is told. */
export function commitTimer(rawSeconds) {
  const seconds = Math.floor(Number(rawSeconds));
  setTimer(seconds);
  broadcast({ type: "timer", seconds });
}

/* ---------------- The dialog ---------------- */

function note(text) {
  const error = el("timer-error");
  if (error) error.textContent = text || "";
}

function openPanel() {
  const modal = el("timer-modal");
  if (!modal) return;
  note("");
  modal.hidden = false;
  const field = el("timer-seconds");
  if (field) field.focus();
}

function closePanel() {
  const modal = el("timer-modal");
  if (modal) modal.hidden = true;
}

/* Administrateur only, wherever they sit: the host is the one that relays. */
function sendTimer() {
  const field = el("timer-seconds");
  if (!field) return;
  const seconds = Math.round(Number(field.value));
  if (!isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    note("Give the timer between 1 and " + MAX_SECONDS + " seconds.");
    return;
  }
  note("");

  if (network.isHost) {
    commitTimer(seconds);
    closePanel();
    return;
  }
  if (sendUpstream({ type: "timer-set", seconds })) {
    closePanel();
    return;
  }
  note("Not connected — the timer went nowhere.");
}

/* Delegated and in the capture phase: the tool row may be reparented freely,
   and no other closer sees the press that opened the dialog. */
document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;

    if (target.closest("#timer-button")) {
      event.preventDefault();
      event.stopPropagation();
      openPanel();
      return;
    }
    if (target.closest("#timer-send")) {
      event.preventDefault();
      event.stopPropagation();
      sendTimer();
      return;
    }
    if (
      target.closest("#timer-modal-close") ||
      (target.closest("#timer-modal") &&
        target.hasAttribute &&
        target.hasAttribute("data-close"))
    ) {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  },
  true,
);

document.addEventListener("keydown", (event) => {
  const modal = el("timer-modal");
  if (!modal || modal.hidden) return;
  if (event.key === "Escape") {
    closePanel();
    return;
  }
  if (event.key === "Enter" && event.target && event.target.id === "timer-seconds") {
    event.preventDefault();
    sendTimer();
  }
});

/* ---------------- The wire ---------------- */

/* Wrapped rather than written into the message table: the countdown is the
   only thing here that needs the wire, and it keeps its own company. */
function installBridge() {
  const handlers = network.handlers;
  if (!handlers || handlers.timerWired) return;
  handlers.timerWired = true;

  const host = handlers.onHostReceiveData;
  handlers.onHostReceiveData = function (connection, data) {
    if (data && data.type === "timer-set") {
      const person = state.roster.get(connection.peer);
      if (person && person.admin) commitTimer(data.seconds);
      return;
    }
    if (typeof host === "function") host(connection, data);
  };

  const guest = handlers.onGuestReceiveData;
  handlers.onGuestReceiveData = function (data) {
    if (data && data.type === "timer") {
      setTimer(data.seconds);
      return;
    }
    if (typeof guest === "function") guest(data);
  };
}

setTimeout(installBridge, 0);
setTimeout(installBridge, 500);
