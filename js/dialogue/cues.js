/* Cue choreography: what plays when. The reader says only what happened; how
   long it takes on screen or in the speakers is settled here.

   Nothing here measures anything of its own — durations come from timing.js,
   and the CSS animations read the same numbers through --dur-*. To retime,
   edit timing.js. Assets are already in memory: js/assets.js holds them from
   boot.

   Every overlay is queued on the one lane in js/sequencer.js rather than
   started where it was asked for. A rolled node takes its place in that queue
   on the frame it lands, so everything else the same node sets off — the
   experience plate, a bar flashing — falls in behind the dice on its own.
   Nothing adds up a delay any more.

   The one thing that does not wait is the hiding. A rolled node's line is
   held out of sight from the frame it arrives, lane free or not, because the
   verdict is written in its check tag and must not be read there first. */

import { dom } from "../dom.js";
import { TIMING } from "../timing.js";
import * as sfx from "../audio/sfx.js";
import * as music from "../audio/music.js";
import * as sequencer from "../sequencer.js";

/* is-held is a line waiting its turn: nothing moves, it is simply not read
   yet. is-rolling is that turn being taken, texture and all. */
const HELD_CLASS = "is-held";
const TAPE_CLASS = "is-rolling";
const FADE_CLASS = "is-fading";

/* The plate a new skill point announces itself with. */
const POINT_ART = "images/new_skillpoint.png";

function href(path) {
  return new URL(path, window.location.href).href;
}

/* Each job keeps its own timers, so cancelling one cannot drop another's. */
function clock() {
  let timers = [];
  return {
    after(ms, action) {
      timers.push(setTimeout(action, Math.max(0, Number(ms) || 0)));
    },
    stop() {
      for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
      timers = [];
    },
  };
}

function holdEntries() {
  if (dom.log) dom.log.classList.add(HELD_CLASS);
  if (dom.stageSide) dom.stageSide.classList.add(HELD_CLASS);
}

function releaseEntries() {
  if (dom.log) dom.log.classList.remove(HELD_CLASS);
  if (dom.stageSide) dom.stageSide.classList.remove(HELD_CLASS);
}

/* Adding a class already there is deliberately a no-op: a later call must not
   restart the animation. */
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
    image.src = href("images/dice/" + value + ".svg");
    image.hidden = false;
    return;
  }
  image.removeAttribute("src");
  image.hidden = true;
}

export function hideVerdict() {
  const host = dom.checkOverlay;
  if (!host) return;
  host.classList.remove("is-in", "is-out");
  host.hidden = true;
}

export function hideXp() {
  const host = dom.xpOverlay;
  if (!host) return;
  host.classList.remove("is-in", "is-out");
  host.hidden = true;
}

/* How long a rolled node owns the screen, tape and verdict together. Only the
   watchdog's estimate now: the lane, not this sum, is what keeps the next
   overlay off the dice. */
export function checkDurationMs() {
  return (
    TIMING.tape.rollMs +
    TIMING.verdict.inMs +
    TIMING.verdict.holdMs +
    TIMING.verdict.outMs
  );
}

/* ---------------- The check verdict ---------------- */

/* Fades in over the viewport, holds for verdict.holdMs, then wipes away. */
function showVerdict(check, result, timers, done) {
  const host = dom.checkOverlay;
  if (!host) {
    done();
    return;
  }

  host.dataset.result = result;
  if (dom.checkOverlayScene) {
    const scene = href(`images/check-${result}-background.png`);
    dom.checkOverlayScene.style.backgroundImage = `url("${scene}")`;
  }
  paintDie(dom.checkDie1, check.dice1);
  paintDie(dom.checkDie2, check.dice2);
  if (dom.checkOverlayTitle) {
    dom.checkOverlayTitle.src = href("images/check-" + result + "-title.svg");
  }

  host.classList.remove("is-in", "is-out");
  host.hidden = false;
  void host.offsetWidth;
  host.classList.add("is-in");

  timers.after(TIMING.verdict.inMs + TIMING.verdict.holdMs, () => {
    host.classList.remove("is-in");
    host.classList.add("is-out");
    timers.after(TIMING.verdict.outMs, () => {
      host.classList.remove("is-out");
      host.hidden = true;
      done();
    });
  });
}

/* One timer decides the rest: at TIMING.tape.rollMs the texture stops and the
   verdict takes its place. The roll cue is held back by
   TIMING.sound.rollDelayMs — the clips are already in memory, so that pause
   is the whole of the delay. The deck ducks out of the way for the sequence
   and comes back on its own. Nothing waits on the audio. */
function runCheck(check, timers, done) {
  const result = check.result === "success" ? "success" : "failure";

  holdEntries();
  startTape();
  music.duck();
  timers.after(TIMING.sound.rollDelayMs, () =>
    sfx.playRoll(result, null, null),
  );
  music.unduck(TIMING.music.duckHoldMs);

  timers.after(TIMING.tape.rollMs, () => {
    stopTape();
    releaseEntries();
    showVerdict(check, result, timers, done);
  });
}

/* Called on the frame a rolled node arrives, before its line is written. The
   entry is held out of sight at once, and the dice take their place in the
   queue: if something else still owns the screen the tape waits for it, and
   the line stays unread either way. */
export function beginRoll(check) {
  holdEntries();
  if (!check) return;

  const timers = clock();
  sequencer.enqueue({
    name: "check",
    timeoutMs: checkDurationMs(),
    run: (done) => runCheck(check, timers, done),
    cancel: () => {
      timers.stop();
      stopTape();
      releaseEntries();
      hideVerdict();
    },
  });
}

/* ---------------- Experience ---------------- */

function runXp(gained, granted, timers, done) {
  const host = dom.xpOverlay;
  if (!host) {
    done();
    return;
  }

  const point = Boolean(granted);
  host.dataset.kind = point ? "point" : "gain";

  /* A point gets a plate of its own; a plain gain is only words. */
  if (dom.xpArt) {
    if (point) {
      dom.xpArt.src = href(POINT_ART);
      dom.xpArt.hidden = false;
    } else {
      dom.xpArt.hidden = true;
      dom.xpArt.removeAttribute("src");
    }
  }

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

  /* The dice have finished with the channel by now, so the point is heard as
     well as read. */
  if (point) sfx.playPoint(null);

  timers.after(TIMING.xp.inMs + TIMING.xp.holdMs, () => {
    host.classList.remove("is-in");
    host.classList.add("is-out");
    timers.after(TIMING.xp.outMs, () => {
      host.classList.remove("is-out");
      host.hidden = true;
      done();
    });
  });
}

/* Two faces, one overlay: a plain gain says what it was worth, a new skill
   point says only that, in green, with the rim lit, its plate up and its own
   cue.

   No delay to pass any more. A rolled node queued its dice first, so this
   simply takes its turn after them. */
export function showXp(gained, granted) {
  if (!dom.xpOverlay || (!gained && !granted)) return;

  const timers = clock();
  sequencer.enqueue({
    name: granted ? "skill-point" : "xp",
    timeoutMs: TIMING.xp.inMs + TIMING.xp.holdMs + TIMING.xp.outMs,
    run: (done) => runXp(gained, granted, timers, done),
    cancel: () => {
      timers.stop();
      hideXp();
    },
  });
}

/* ---------------- Voices ---------------- */

/* An active rolled check owns the moment: the dice are the only thing heard,
   so the speaker's jingle is left out — beginRoll has already queued them. A
   passive is rolled behind the reader's back: no tape, no dice, no cue, and
   the jingle still rings. */
export function playNode(voice, check) {
  const rolled = Boolean(check && check.result && !check.passive);
  const attribute = voice ? voice.attribute : null;
  if (attribute && !rolled) sfx.playJingle(attribute, null);
}

/* The timer is the fallback for browsers that never fire animationend. A
   choice row fades where it stands rather than over the viewport, so it needs
   no turn in the queue. */
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
  /* Cancels whatever was queued or mid-turn, which puts the screen back. */
  sequencer.clear();
  sfx.stopAll();
  stopTape();
  releaseEntries();
  hideVerdict();
  hideXp();
  /* Whatever the deck was ducked for is over. */
  music.unduck(0);
}
