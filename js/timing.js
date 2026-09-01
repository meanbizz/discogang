/* Every duration in the app. The JS timers import TIMING; the stylesheet gets
   the same numbers through the --dur-* properties applyTiming writes onto
   :root at boot. tokens.css carries identical fallbacks, but this file is the
   source of truth.

   Order of a rolled check:
     0ms            tape on, entry written already invisible, both cues start
     tape.rollMs    tape off, verdict fades in over verdict.inMs
     + holdMs       verdict holds
     + outMs        verdict wipes away left to right

   Nothing here waits on how long an audio file happens to be. */

export const TIMING = {
  /* rollMs is the only number that decides when the verdict lands; cycleMs
     and stepPx are the scroll's look, not its length. */
  tape: {
    rollMs: 1200,
    cycleMs: 220,
    stepPx: 420,
  },

  verdict: {
    inMs: 220,
    holdMs: 2500,
    outMs: 700,
  },

  /* fallbackMs stands in for a duration the browser never reports; leadMs is
     how long before a clip ends its onLead fires. */
  sound: {
    volume: 0.525,
    fallbackMs: 1600,
    metadataWaitMs: 600,
    leadMs: 1000,
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
  "--tape-step": TIMING.tape.stepPx + "px",
};

export function applyTiming(root) {
  const host = root || document.documentElement;
  Object.keys(CSS_TIMING).forEach((name) => {
    host.style.setProperty(name, CSS_TIMING[name]);
  });
}
