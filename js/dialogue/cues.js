/* Cue choreography: what plays when. The reader says only what happened; how
   long it takes on screen or in the speakers is settled here.

   Nothing here measures anything of its own — durations come from timing.js,
   and the CSS animations read the same numbers through --dur-*. To retime,
   edit timing.js; to reorder, edit runCheck. */

import { dom } from "../dom.js";
import { TIMING } from "../timing.js";
import * as sfx from "../audio/sfx.js";

const TAPE_CLASS = "is-rolling";
const FADE_CLASS = "is-fading";

const CHECK_ART = [
  "images/check-success-background.png",
  "images/check-failure-background.png",
  "images/check-success-title.svg",
  "images/check-failure-title.svg",
];

const artHeld = [];
let timers = [];

/* Every cue and every piece of verdict art into memory, so a verdict never
   waits on a fetch. Safe to call more than once. */
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

function clearTimers() {
  for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
  timers = [];
}

function after(ms, action) {
  timers.push(setTimeout(action, Math.max(0, ms)));
}

/* Adding a class already there is deliberately a no-op: it goes on before the
   node is written, and a later call must not restart the animation. */
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

function paintDie(image, value) {
  if (!image) return;
  if (value) {
    image.src = new URL(
      "images/dice/" + value + ".svg",
      window.location.href,
    ).href;
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

/* Fades in over the viewport, holds for verdict.holdMs, then wipes away. */
function showVerdict(check, result) {
  const host = dom.checkOverlay;
  if (!host) return;

  host.dataset.result = result;
  if (dom.checkOverlayScene) {
    const resultUrl = new URL(
      `images/check-${result}-background.png`,
      window.location.href,
    ).href;
    dom.checkOverlayScene.style.backgroundImage = `url("${resultUrl}")`;
  }
  paintDie(dom.checkDie1, check.dice1);
  paintDie(dom.checkDie2, check.dice2);
  if (dom.checkOverlayTitle) {
    dom.checkOverlayTitle.src = new URL(
      "images/check-" + result + "-title.svg",
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

/* Called on the frame a rolled node arrives, before it is written: standing
   entries and the portrait fade as the texture starts moving. Any verdict
   still on screen is cleared, dropping its pending timers with it. */
export function beginRoll() {
  hideVerdict();
  startTape();
}

/* One timer decides the rest: at TIMING.tape.rollMs the texture stops and the
   verdict takes its place. Nothing waits on the audio. */
function runCheck(check) {
  const result = check.result === "success" ? "success" : "failure";

  startTape();
  sfx.playRoll(result, null, null);

  after(TIMING.tape.rollMs, () => {
    stopTape();
    showVerdict(check, result);
  });
}

/* A skill speaking plays its attribute's jingle; a node that also rolls runs
   both on their own channels. */
export function playNode(voice, check) {
  const attribute = voice ? voice.attribute : null;
  if (attribute) sfx.playJingle(attribute, null);
  if (check && check.result) runCheck(check);
}

/* The timer is the fallback for browsers that never fire animationend. */
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

export function reset() {
  sfx.stopAll();
  stopTape();
  hideVerdict();
}
