/* Sound cues — playback only. One jingle per attribute plus the two roll
   clips, pulled into memory up front so a cue never waits on the network.

   Jingles and rolls sit on separate channels, so a skill's voice can ring on
   while the dice roll. Timings come from the clip's own duration, or from
   TIMING.sound.fallbackMs when the browser reports none. */

import { TIMING } from "../timing.js";
import { halt, rewind, start } from "./channel.js";

export const JINGLE_SRC = {
  intellect: "sounds/IntellectJingle.mp3",
  psyche: "sounds/PsyJingle.mp3",
  physique: "sounds/PhysicalJingle.mp3",
  motorics: "sounds/MotoricsJingle.mp3",
};

export const ROLL_SRC = {
  success: "sounds/RollSuccess.mp3",
  failure: "sounds/RollFailure.mp3",
};

const cache = {};

const channels = {
  jingle: { voice: null, timers: [] },
  roll: { voice: null, timers: [] },
};

function own(map, key) {
  return (
    typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key)
  );
}

function clip(src) {
  if (!cache[src]) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = new URL(src, window.location.href).href;
    try {
      audio.load();
    } catch (error) {
      /* nothing to fetch yet */
    }
    cache[src] = audio;
  }
  /* Set every time, so a cached clip picks up the current level. */
  cache[src].volume = TIMING.sound.volume;
  return cache[src];
}

/* Loading needs no user gesture — only playback does. */
export function preloadAll() {
  Object.keys(JINGLE_SRC).forEach((key) => clip(JINGLE_SRC[key]));
  Object.keys(ROLL_SRC).forEach((key) => clip(ROLL_SRC[key]));
}

function clearTimers(channel) {
  for (let i = 0; i < channel.timers.length; i += 1) {
    clearTimeout(channel.timers[i]);
  }
  channel.timers = [];
}

function stopChannel(channel) {
  clearTimers(channel);
  if (!channel.voice) return;
  halt(channel.voice);
  channel.voice = null;
}

export function stopAll() {
  stopChannel(channels.jingle);
  stopChannel(channels.roll);
}

function durationMs(audio) {
  const seconds = Number(audio.duration);
  return isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/* hooks.onLead fires TIMING.sound.leadMs before the end, hooks.onEnd just
   after it. */
function run(channel, src, hooks) {
  stopChannel(channel);

  const audio = clip(src);
  channel.voice = audio;
  rewind(audio);
  start(audio);

  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    const total = durationMs(audio) || TIMING.sound.fallbackMs;
    if (hooks.onLead) {
      channel.timers.push(
        setTimeout(hooks.onLead, Math.max(0, total - TIMING.sound.leadMs)),
      );
    }
    if (hooks.onEnd) channel.timers.push(setTimeout(hooks.onEnd, total + 60));
  };

  if (audio.readyState >= 1) {
    arm();
    return;
  }
  audio.addEventListener("loadedmetadata", arm, { once: true });
  channel.timers.push(setTimeout(arm, TIMING.sound.metadataWaitMs));
}

export function playJingle(attribute, onEnd) {
  if (!own(JINGLE_SRC, attribute)) {
    if (onEnd) onEnd();
    return;
  }
  run(channels.jingle, JINGLE_SRC[attribute], { onEnd: onEnd || null });
}

export function playRoll(result, onLead, onEnd) {
  const src = result === "success" ? ROLL_SRC.success : ROLL_SRC.failure;
  run(channels.roll, src, { onLead: onLead || null, onEnd: onEnd || null });
}
