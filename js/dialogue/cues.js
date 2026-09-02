/* Cue choreography: what plays when. The reader says only what happened; how
   long it takes on screen or in the speakers is settled here.

   Nothing here measures anything of its own — durations come from timing.js,
   and the CSS animations read the same numbers through --dur-*. To retime,
   edit timing.js; to reorder, edit runCheck. Assets are already in memory:
   js/assets.js holds them from boot. */

import { dom } from "../dom.js";
import { TIMING } from "../timing.js";
import * as sfx from "../audio/sfx.js";
import * as music from "../audio/music.js";

const TAPE_CLASS = "is-rolling";
const FADE_CLASS = "is-fading";

let timers = [];
let xpTimers = [];

function clearTimers() {
  for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
  timers = [];
}

function after(ms, action) {
  timers.push(setTimeout(action, Math.max(0, ms)));
}

/* The experience overlay keeps its own timers. A rolled node can hand over XP
   as well, and clearing the verdict's schedule must not cancel what is queued
   to follow it. */
function clearXpTimers() {
  for (let i = 0; i < xpTimers.length; i += 1) clearTimeout(xpTimers[i]);
  xpTimers = [];
}

function afterXp(ms, action) {
  xpTimers.push(setTimeout(action, Math.max(0, ms)));
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

/* ---------------- Experience ---------------- */

export function hideXp() {
  clearXpTimers();
  const host = dom.xpOverlay;
  if (!host) return;
  host.classList.remove("is-in", "is-out");
  host.hidden = true;
}

/* How long a rolled node owns the screen, tape and verdict together. An XP
   overlay on the same node waits this out, so the two never share it. */
export function checkDurationMs() {
  return (
    TIMING.tape.rollMs +
    TIMING.verdict.inMs +
    TIMING.verdict.holdMs +
    TIMING.verdict.outMs
  );
}

function paintXp(gained, granted) {
  const host = dom.xpOverlay;
  if (!host) return;

  const point = Boolean(granted);
  host.dataset.kind = point ? "point" : "gain";

  if (dom.xpTitle) {
    dom.xpTitle.textContent = point ? "New skill point!" : "Gained experience";
  }
  if (dom.xpAmount) {
    dom.xpAmount.textContent = "+" + gained + " XP";
    /* A point is the news; the experience that bought it would read as small
       print beside it. */
    dom.xpAmount.hidden = point;
  }

  host.classList.remove("is-in", "is-out");
  host.hidden = false;
  /* The vignette's own animation restarts with the display flip. */
  void host.offsetWidth;
  host.classList.add("is-in");

  afterXp(TIMING.xp.inMs + TIMING.xp.holdMs, () => {
    host.classList.remove("is-in");
    host.classList.add("is-out");
    afterXp(TIMING.xp.outMs, () => {
      host.classList.remove("is-out");
      host.hidden = true;
    });
  });
}

/* Two faces, one overlay: a plain gain says what it was worth, a new skill
   point says only that, in green, with the rim lit.

   delayMs is how long to stay out of the way first — a rolled node passes
   checkDurationMs(), so the dice have finished before the words arrive. */
export function showXp(gained, granted, delayMs) {
  if (!dom.xpOverlay || (!gained && !granted)) return;

  clearXpTimers();
  const wait = Math.max(0, Number(delayMs) || 0);
  if (!wait) {
    paintXp(gained, granted);
    return;
  }
  afterXp(wait, () => paintXp(gained, granted));
}

/* Called on the frame a rolled node arrives, before it is written: standing
   entries and the portrait fade as the texture starts moving. Any verdict
   still on screen is cleared, dropping its pending timers with it. */
export function beginRoll() {
  hideVerdict();
  startTape();
}

/* One timer decides the rest: at TIMING.tape.rollMs the texture stops and the
   verdict takes its place. The roll cue is held back by
   TIMING.sound.rollDelayMs — the clips are already in memory, so that pause
   is the whole of the delay. The deck ducks out of the way for the sequence
   and comes back on its own. Nothing waits on the audio. */
function runCheck(check) {
  const result = check.result === "success" ? "success" : "failure";

  startTape();
  music.duck();
  after(TIMING.sound.rollDelayMs, () => sfx.playRoll(result, null, null));
  music.unduck(TIMING.music.duckHoldMs);

  after(TIMING.tape.rollMs, () => {
    stopTape();
    showVerdict(check, result);
  });
}

/* An active rolled check owns the moment: the dice are the only thing heard,
   so the speaker's jingle is left out. A passive is rolled behind the
   reader's back — no tape, no dice, no cue, and the jingle still rings. */
export function playNode(voice, check) {
  const rolled = Boolean(check && check.result && !check.passive);
  const attribute = voice ? voice.attribute : null;
  if (attribute && !rolled) sfx.playJingle(attribute, null);
  if (rolled) runCheck(check);
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
  hideXp();
  /* Whatever the deck was ducked for is over. */
  music.unduck(0);
}
