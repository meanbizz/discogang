/* Every duration in the app, in one place.

   Anything that waits, fades, holds or repeats reads its number from here:
   the JS timers import TIMING directly, the stylesheet gets the same numbers
   through the --dur-* custom properties that applyTiming() writes onto :root
   at boot. tokens.css carries identical fallbacks so the sheet still stands
   on its own, but this file is the source of truth — change a number here and
   both sides follow.

   Order of a rolled check, for reference:

     0ms                   tape on; the entry is written already invisible
     0ms                   jingle starts     (its own channel)
     0ms                   roll clip starts  (its own channel)
     tape.rollMs           tape off, verdict fades in over verdict.inMs
     + verdict.holdMs      verdict holds
     + verdict.outMs       verdict wipes away left to right

   The whole sequence is on a clock of its own — nothing here waits on how
   long an audio file happens to be, so a slow or blocked cue cannot stretch
   it or strand it. */

export const TIMING = {
  /* The panel texture running past like tape during a roll.

     rollMs is the length of the roll: how long the tape runs before the
     verdict takes its place. Lower it for a snappier check, raise it to draw
     the tension out. This is the only number that decides when the verdict
     lands.

     cycleMs and stepPx are looks, not length — one turn of the loop and how
     far the texture travels in that turn. Together they set how fast it
     appears to scroll. Neither affects rollMs. */
  tape: {
    rollMs: 1400,
    cycleMs: 220,
    stepPx: 420,
  },

  /* The verdict card: fade in, sit there, wipe away. */
  verdict: {
    inMs: 220,
    holdMs: 2500,
    outMs: 700,
  },

  /* Cue playback. fallbackMs stands in for a duration the browser never
     reports; leadMs is how long before a clip ends its onLead fires, for any
     caller that asks for one. */
  sound: {
    volume: 0.525,
    fallbackMs: 1600,
    metadataWaitMs: 600,
    leadMs: 1000,
  },

  /* Standing entries and the scene portrait dropping out under the tape. */
  entry: { fadeMs: 150 },

  /* A terminal row of choices bowing out. clearBufferMs is the slack on the
     fallback timer for browsers that never fire animationend. */
  choice: { fadeMs: 420, clearBufferMs: 120 },

  /* One flash of a vitals bar. */
  vitals: { flashMs: 560, clearBufferMs: 40 },
};

/* The half of TIMING the stylesheet needs. */
export const CSS_TIMING = {
  "--dur-entry-fade": TIMING.entry.fadeMs + "ms",
  "--dur-choice-fade": TIMING.choice.fadeMs + "ms",
  "--dur-tape-cycle": TIMING.tape.cycleMs + "ms",
  "--dur-verdict-in": TIMING.verdict.inMs + "ms",
  "--dur-verdict-out": TIMING.verdict.outMs + "ms",
  "--dur-vital-flash": TIMING.vitals.flashMs + "ms",
  "--tape-step": TIMING.tape.stepPx + "px",
};

/* Called once at boot, before anything can animate. */
export function applyTiming(root) {
  const host = root || document.documentElement;
  Object.keys(CSS_TIMING).forEach((name) => {
    host.style.setProperty(name, CSS_TIMING[name]);
  });
}
