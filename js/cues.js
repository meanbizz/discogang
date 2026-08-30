/* Cue choreography: what plays when.

   The reader says only what happened — a skill spoke, a check resolved, a row
   of choices is finished with. Everything about how long that takes on screen
   or in the speakers is settled here.

   Nothing in this file measures anything of its own: durations come from
   timing.js, and the CSS animations behind these classes read the same
   numbers through the --dur-* properties. To retime the sequence, edit
   timing.js; to reorder it, edit runCheck below. */

import { dom } from "./dom.js";
import { TIMING } from "./timing.js";
import * as sfx from "./sfx.js";

/* Classes the stylesheet animates. */
const TAPE_CLASS = "is-rolling";
const FADE_CLASS = "is-fading";

/* Overlay art, held in memory from boot so the verdict never waits on a
   fetch at the moment the tape stops. */
const CHECK_ART = [
  "images/check-success-background.png",
  "images/check-failure-background.png",
  "images/check-success-title.svg",
  "images/check-failure-title.svg",
];

const artHeld = [];
let timers = [];

/* ---------------- Loading ---------------- */

/* Pulls every cue and every piece of verdict art into memory. Safe to call
   more than once; the browser serves the second pass from cache. */
export function preloadAll() {
  sfx.preloadAll();
  if (artHeld.length) return;

  const wanted = CHECK_ART.slice();
  for (let i = 1; i <= 6; i += 1) wanted.push("images/dice/" + i + ".svg");

  wanted.forEach((src) => {
    const image = new Image();
    image.src = new URL(src, window.location.href).href;
    /* Keeping the reference is what keeps the decode around. */
    artHeld.push(image);
  });
}

/* ---------------- Timers ---------------- */

function clearTimers() {
  for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
  timers = [];
}

function after(ms, action) {
  timers.push(setTimeout(action, Math.max(0, ms)));
}

/* ---------------- Tape ---------------- */

/* The tape class rides on the log and on the scene column, so the texture
   scrolls while the entries and the portrait are held out of sight.

   Adding a class that is already there is deliberately a no-op: the class
   goes on before the node is written and any later call — from the check
   sequence itself — must not restart the animation or bounce the fade. */
function startTape() {
  if (dom.log && !dom.log.classList.contains(TAPE_CLASS)) {
    dom.log.classList.add(TAPE_CLASS);
  }
  if (dom.stageSide && !dom.stageSide.classList.contains(TAPE_CLASS)) {
    dom.stageSide.classList.add(TAPE_CLASS);
  }
}

function stopTape() {
  if (dom.log) dom.log.classList.remove(TAPE_CLASS);
  if (dom.stageSide) dom.stageSide.classList.remove(TAPE_CLASS);
}

/* ---------------- Verdict overlay ---------------- */

/* A face only shows when there is a real die behind it. */
function paintDie(image, value) {
  if (!image) return;
  if (value) {
    const resultSrc = "images/dice/" + value + ".svg";
    image.src = new URL(resultSrc, window.location.href).href;
    image.hidden = false;
    return;
  }
  image.removeAttribute("src");
  image.hidden = true;
}

export function hideVerdict() {
  clearTimers();
  const host = dom.checkOverlay;
  if (!host) return;
  host.classList.remove("is-in", "is-out");
  host.hidden = true;
}

/* Fades in over the whole viewport, holds for verdict.holdMs, then wipes
   away left to right. */
function showVerdict(check, result) {
  const host = dom.checkOverlay;
  if (!host) return;

  host.dataset.result = result;
  if (dom.checkOverlayScene) {
    dom.checkOverlayScene.style.backgroundImage =
      'url("../images/check-' + result + '-background.png")';
  }
  paintDie(dom.checkDie1, check.dice1);
  paintDie(dom.checkDie2, check.dice2);
  if (dom.checkOverlayTitle) {
    dom.checkOverlayTitle.src = new URL(
      "../images/check-" + result + "-title.svg",
      window.location.href,
    ).href;
  }

  host.classList.remove("is-in", "is-out");
  host.hidden = false;
  void host.offsetWidth;
  host.classList.add("is-in");

  after(TIMING.verdict.inMs + TIMING.verdict.holdMs, () => {
    host.classList.remove("is-in");
    host.classList.add("is-out");
    after(TIMING.verdict.outMs, () => {
      host.classList.remove("is-out");
      host.hidden = true;
    });
  });
}

/* ---------------- The sequence ---------------- */

/* Called on the same frame a rolled node arrives, before it is written:
   nothing new is legible during a roll, so the standing entries and the
   portrait start their fade as the texture starts moving, and the incoming
   entry is already invisible when it lands. A verdict still on screen from a
   previous node is cleared out of the way first — which also drops any timer
   that verdict still had pending. */
export function beginRoll() {
  hideVerdict();
  startTape();
}

/* The tape is already running by the time this is called. One timer decides
   the rest: at TIMING.tape.rollMs the texture stops and the verdict takes its
   place. Nothing waits on the audio, so the visuals keep their schedule even
   if a cue is slow, silent or missing. */
function runCheck(check) {
  const result = check.result === "success" ? "success" : "failure";

  startTape();
  sfx.playRoll(result, null, null);

  after(TIMING.tape.rollMs, () => {
    stopTape();
    showVerdict(check, result);
  });
}

/* A skill speaking plays its attribute's jingle. When the same node also
   rolls, the jingle and the dice run together on their own channels — the
   roll no longer waits for the voice to clear, so the tape starts at once. */
export function playNode(voice, check) {
  const attribute = voice ? voice.attribute : null;
  if (attribute) sfx.playJingle(attribute, null);
  if (check && check.result) runCheck(check);
}

/* ---------------- Odds and ends ---------------- */

/* Plays the fade class out, then drops the node. The timer is the fallback
   for browsers that never fire animationend. */
export function fadeOutAndRemove(node, done) {
  if (!node) {
    if (done) done();
    return;
  }
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    node.remove();
    if (done) done();
  };
  node.addEventListener("animationend", settle, { once: true });
  setTimeout(settle, TIMING.choice.fadeMs + TIMING.choice.clearBufferMs);
  node.classList.add(FADE_CLASS);
}

/* Everything back to silence and stillness. */
export function reset() {
  sfx.stopAll();
  stopTape();
  hideVerdict();
}
