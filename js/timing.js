/* js/timing.js */

/* Every duration in the app. The JS timers import TIMING; the stylesheet gets
   the same numbers through the --dur-* properties applyTiming writes onto
   :root at boot. tokens.css carries identical fallbacks, but this file is the
   source of truth.

   Order of a rolled check:
     0ms            tape on, entry written already invisible, jingle starts,
                    music ducks away over music.duckOutMs
     sound.rollDelayMs  the roll cue fires
     tape.rollMs    tape off, verdict fades in over verdict.inMs
     + holdMs       verdict holds
     + outMs        verdict wipes away left to right
     music.duckHoldMs from the roll, the music fades back in over duckInMs

   A node that also hands over experience shows its plate after all of that; a
   step of health or morale it spent takes its own turn, and a payment that
   arrived with the same payload takes another. Nothing here says so:
   js/sequencer.js runs them one after another, which is what lets these
   numbers be changed freely without two overlays landing at once.
   cues.checkDurationMs is the same sum, kept only as the lane's watchdog
   estimate for the check.

   Nothing here waits on how long an audio file happens to be. */

/* Named first, because the music duck holds for the whole sequence below. */
const TAPE_ROLL_MS = 1200;
const VERDICT_IN_MS = 220;
const VERDICT_HOLD_MS = 2500;
const VERDICT_OUT_MS = 700;

export const TIMING = {
  /* rollMs is the only number that decides when the verdict lands; cycleMs
     and stepPx are the scroll's look, not its length. */
  tape: {
    rollMs: TAPE_ROLL_MS,
    cycleMs: 220,
    stepPx: 420,
  },

  verdict: {
    inMs: VERDICT_IN_MS,
    holdMs: VERDICT_HOLD_MS,
    outMs: VERDICT_OUT_MS,
  },

  /* The experience overlay. vignetteMs is the green rim's fade for a new
     skill point; it is shorter than inMs + holdMs on purpose, so the glow has
     settled before the words are read. artMs is the plate rising into place
     behind them, and is kept inside the same window. */
  xp: {
    inMs: 220,
    holdMs: 1800,
    outMs: 600,
    vignetteMs: 260,
    artMs: 420,
  },

  /* The notice plate — money, health and morale, and whatever else earns one.
     Shorter than experience on purpose: a payment or a bruise is a fact, not
     an achievement, and several can arrive in a row. */
  notice: {
    inMs: 200,
    holdMs: 1500,
    outMs: 600,
    artMs: 420,
  },

  /* fallbackMs stands in for a duration the browser never reports; leadMs is
     how long before a clip ends its onLead fires. rollDelayMs is the pause
     between a rolled node landing and its roll cue — the clips are already in
     memory, so this is the whole of the delay. retryMs is how long a clip is
     given to actually leave the starting line before it is asked once more:
     the guard against a play() the element quietly refused while it was still
     loading, which is what used to swallow the rarer cues. */
  sound: {
    volume: 0.525,
    fallbackMs: 1600,
    metadataWaitMs: 600,
    leadMs: 1000,
    rollDelayMs: 200,
    retryMs: 220,
  },

  /* The deck's own volume envelope. volume is the level a track settles at;
     duckVolume is where a dice roll pushes it. duckHoldMs is measured from
     the roll starting, so it covers the tape and the whole verdict. stepMs is
     the ramp's resolution, not a duration anybody waits on. */
  music: {
    volume: 45,
    duckVolume: 0,
    fadeMs: 3000,
    duckOutMs: 200,
    duckInMs: 3000,
    duckHoldMs: TAPE_ROLL_MS + VERDICT_IN_MS + VERDICT_HOLD_MS + VERDICT_OUT_MS,
    stepMs: 40,
  },

  entry: { fadeMs: 150 },

  /* clearBufferMs is slack on the fallback timer for browsers that never
     fire animationend. */
  choice: { fadeMs: 420, clearBufferMs: 120 },

  vitals: { flashMs: 560, clearBufferMs: 40 },
};

export const CSS_TIMING = {
  "--dur-entry-fade": TIMING.entry.fadeMs + "ms",
  "--dur-choice-fade": TIMING.choice.fadeMs + "ms",
  "--dur-tape-cycle": TIMING.tape.cycleMs + "ms",
  "--dur-verdict-in": TIMING.verdict.inMs + "ms",
  "--dur-verdict-out": TIMING.verdict.outMs + "ms",
  "--dur-vital-flash": TIMING.vitals.flashMs + "ms",
  "--dur-xp-in": TIMING.xp.inMs + "ms",
  "--dur-xp-out": TIMING.xp.outMs + "ms",
  "--dur-xp-vignette": TIMING.xp.vignetteMs + "ms",
  "--dur-xp-art": TIMING.xp.artMs + "ms",
  "--dur-notice-in": TIMING.notice.inMs + "ms",
  "--dur-notice-out": TIMING.notice.outMs + "ms",
  "--dur-notice-art": TIMING.notice.artMs + "ms",
  "--tape-step": TIMING.tape.stepPx + "px",
};

export function applyTiming(root) {
  const host = root || document.documentElement;
  Object.keys(CSS_TIMING).forEach((name) => {
    host.style.setProperty(name, CSS_TIMING[name]);
  });
}
