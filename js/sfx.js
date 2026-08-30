/* Sound cues for dialogue rounds.

   One jingle per attribute, plus the two roll clips. Timings come from the
   clip's own duration when the browser reports it and from FALLBACK_MS when
   it does not, so a blocked or missing file never strands the visual
   sequence that hangs off these callbacks. */

const JINGLE_SRC = {
  intellect: "/sounds/IntellectJingle.mp3",
  psyche: "/sounds/PsyJingle.mp3",
  physique: "/sounds/PhysicalJingle.mp3",
  motorics: "/sounds/MotoricsJingle.mp3",
};

const ROLL_SRC = {
  success: "/sounds/RollSuccess.mp3",
  failure: "/sounds/RollFailure.mp3",
};

/* Every cue in this file plays at this level — a quarter under the old 0.7. */
const VOLUME = 0.525;
const FALLBACK_MS = 1600;
const METADATA_WAIT_MS = 600;
/* Kept for callers that want a cue shortly before a clip runs out. */
const LEAD_MS = 500;

const cache = {};
let timers = [];
let voice = null;

function own(map, key) {
  return (
    typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key)
  );
}

function clip(src) {
  if (!cache[src]) {
    const audio = new Audio(src);
    audio.preload = "auto";
    cache[src] = audio;
  }
  /* Set every time, so a cached clip picks up the current level. */
  cache[src].volume = VOLUME;
  return cache[src];
}

function clearTimers() {
  for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
  timers = [];
}

function stopVoice() {
  if (!voice) return;
  try {
    voice.pause();
    voice.currentTime = 0;
  } catch (error) {
    /* nothing to rewind */
  }
  voice = null;
}

export function stopAll() {
  clearTimers();
  stopVoice();
}

function durationMs(audio) {
  const seconds = Number(audio.duration);
  return isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/* hooks.onLead fires LEAD_MS before the end, hooks.onEnd just after it. */
function run(src, hooks) {
  clearTimers();
  stopVoice();

  const audio = clip(src);
  voice = audio;
  try {
    audio.currentTime = 0;
  } catch (error) {
    /* not seekable yet */
  }

  const started = audio.play();
  if (started && started.catch) started.catch(() => {});

  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    const total = durationMs(audio) || FALLBACK_MS;
    if (hooks.onLead) {
      timers.push(setTimeout(hooks.onLead, Math.max(0, total - LEAD_MS)));
    }
    if (hooks.onEnd) timers.push(setTimeout(hooks.onEnd, total + 60));
  };

  if (audio.readyState >= 1) {
    arm();
    return;
  }
  audio.addEventListener("loadedmetadata", arm, { once: true });
  timers.push(setTimeout(arm, METADATA_WAIT_MS));
}

export function playJingle(attribute, onEnd) {
  if (!own(JINGLE_SRC, attribute)) {
    if (onEnd) onEnd();
    return;
  }
  run(JINGLE_SRC[attribute], { onEnd: onEnd || null });
}

export function playRoll(result, onLead, onEnd) {
  const src = result === "success" ? ROLL_SRC.success : ROLL_SRC.failure;
  run(src, { onLead: onLead || null, onEnd: onEnd || null });
}
