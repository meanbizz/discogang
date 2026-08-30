/* Sound cues for dialogue rounds — playback only.

   One jingle per attribute, plus the two roll clips. Every file is pulled
   into memory once, up front, so a cue never waits on the network at the
   moment it is needed.

   Jingles and rolls sit on separate channels: a skill's voice can keep
   ringing while the dice are already rolling, so neither cue has to wait for
   the other to clear.

   Nothing here decides when a cue fires — that belongs to cues.js, and every
   number this file leans on comes from timing.js. Timings come from the
   clip's own duration when the browser reports it and from
   TIMING.sound.fallbackMs when it does not, so a blocked or missing file
   never strands the visual sequence that hangs off these callbacks. */

import { TIMING } from "./timing.js";

export const JINGLE_SRC = {
  intellect: "/sounds/IntellectJingle.mp3",
  psyche: "/sounds/PsyJingle.mp3",
  physique: "/sounds/PhysicalJingle.mp3",
  motorics: "/sounds/MotoricsJingle.mp3",
};

export const ROLL_SRC = {
  success: "/sounds/RollSuccess.mp3",
  failure: "/sounds/RollFailure.mp3",
};

const cache = {};

/* One slot per kind of cue. Starting a jingle no longer cuts a roll short,
   and the other way round. */
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
    audio.src = src;
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

/* Called once at boot: fetches and decodes every cue so the first roll of the
   session is as prompt as the tenth. Loading needs no user gesture — only
   playback does. */
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
  try {
    channel.voice.pause();
    channel.voice.currentTime = 0;
  } catch (error) {
    /* nothing to rewind */
  }
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
   after it. With preloadAll behind us the metadata is already in hand, so
   both timers are armed on the same tick the clip starts. */
function run(channel, src, hooks) {
  stopChannel(channel);

  const audio = clip(src);
  channel.voice = audio;
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
