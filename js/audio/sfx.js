/* js/audio/sfx.js */

/* Sound cues — playback only. One jingle per attribute, the two roll clips,
   the skill point and the experience that bought none, health and morale in
   both directions, the two money clips, and the interface answering for
   itself — a line taken, a dialog thrown open, a dialog dismissed, the ready
   switch flipped, a skill card picked up, a point spent on one. All of them
   are pulled into memory up front, so a cue never waits on the network.

   Each kind sits on its own channel, so a skill's voice can ring on while the
   dice roll and money changing hands is heard over neither. Timings come from
   the clip's own duration, or from TIMING.sound.fallbackMs when the browser
   reports none.

   Starting a clip is deliberately forgiving. Seeking one whose metadata has
   not arrived throws in some browsers, and a play() the element refuses while
   it is still loading resolves into nothing at all — either was enough to
   swallow a whole cue, and the skill point's was the likeliest to go: the
   rarest clip in the set, on a channel nothing else touches, asked for long
   after boot. Both halves are guarded now, and a clip still sitting at zero a
   beat later is asked once more on the channel's own timer, so a halted cue
   stays halted.

   Silence comes in three sizes: stopScene for the round's own voices,
   stopNotices for the plates that outlive it, stopAll for everything. */

import { TIMING } from "../timing.js";
import { halt, rewind, start } from "./channel.js";

export const JINGLE_SRC = {
  intellect: "sounds/interface-skill-passiveINT.wav",
  psyche: "sounds/interface-skill-passivePSY.wav",
  physique: "sounds/interface-skill-passiveFYS.wav",
  motorics: "sounds/interface-skill-passiveMOT.wav",
};

export const ROLL_SRC = {
  success: "sounds/interface-diceroll-success.wav",
  failure: "sounds/interface-diceroll-fail.wav",
};

/* What a new skill point sounds like, and what experience that fell short of
   one sounds like. Never both: the point is the news. */
export const POINT_SRC = "sounds/new-skill-point.wav";
export const XP_SRC = "sounds/exp-gained.wav";

/* Money, in each direction. */
export const MONEY_SRC = {
  gained: "sounds/money-gained.wav",
  lost: "sounds/money-lost.wav",
};

/* Health and morale, in each direction. */
export const VITAL_SRC = {
  health: {
    gain: "sounds/health-healed.wav",
    loss: "sounds/health-damaged.wav",
  },
  morale: {
    gain: "sounds/morale-healed.wav",
    loss: "sounds/morale-damaged.wav",
  },
};

/* The interface's own blips. */
export const UI_SRC = {
  click: "sounds/dialogue-click.wav",
  cancel: "sounds/cancel.wav",
  modal: "sounds/switch-02.wav",
  ready: "sounds/switch-04.wav",
  send: "sounds/switch-01.wav",
  skillPick: "sounds/skill-choosing.wav",
  skillLevel: "sounds/skills-leveling.wav",
};

const cache = {};

const channels = {
  jingle: { voice: null, timers: [] },
  roll: { voice: null, timers: [] },
  point: { voice: null, timers: [] },
  xp: { voice: null, timers: [] },
  money: { voice: null, timers: [] },
  vital: { voice: null, timers: [] },
  ui: { voice: null, timers: [] },
  skill: { voice: null, timers: [] },
};

/* The round's own voices, and the plates that keep their place through a
   reset. The blips belong to neither: a click the player made is still a
   click the player made. */
const SCENE_VOICES = ["jingle", "roll", "point", "xp"];
const NOTICE_VOICES = ["money", "vital"];

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
  Object.keys(MONEY_SRC).forEach((key) => clip(MONEY_SRC[key]));
  Object.keys(VITAL_SRC).forEach((kind) => {
    clip(VITAL_SRC[kind].gain);
    clip(VITAL_SRC[kind].loss);
  });
  Object.keys(UI_SRC).forEach((key) => clip(UI_SRC[key]));
  clip(POINT_SRC);
  clip(XP_SRC);
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
  const voice = channel.voice;
  /* Dropped before it is halted, so nothing waiting on this channel can
     revive it. */
  channel.voice = null;
  try {
    halt(voice);
  } catch (error) {
    /* already silent */
  }
}

function stopNamed(names) {
  names.forEach((name) => {
    if (channels[name]) stopChannel(channels[name]);
  });
}

/* What a round beginning is entitled to silence. */
export function stopScene() {
  stopNamed(SCENE_VOICES);
}

/* A plate that keeps its place through a reset keeps its voice with it; only
   leaving the room drops both. */
export function stopNotices() {
  stopNamed(NOTICE_VOICES);
}

export function stopAll() {
  Object.keys(channels).forEach((name) => stopChannel(channels[name]));
}

function durationMs(audio) {
  const seconds = Number(audio.duration);
  return isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/* One attempt at sound. A refusal is an answer, not an error: the element may
   be waiting on a gesture, and channel.js is what remembers that. */
function attempt(audio) {
  let played = null;
  try {
    played = start(audio);
  } catch (error) {
    return;
  }
  if (played && typeof played.catch === "function") played.catch(() => {});
}

/* Rewind, start, and — if the element is still parked at zero a beat later —
   start once more. The retry rides the channel's own timer list and checks it
   still owns the voice, so a cue halted in the meantime stays halted, and a
   clip that simply finished early is left alone. */
function play(channel, audio) {
  try {
    rewind(audio);
  } catch (error) {
    /* A clip whose metadata has not landed cannot always be seeked; it plays
       from the top regardless. */
  }
  attempt(audio);
  channel.timers.push(
    setTimeout(() => {
      if (channel.voice !== audio) return;
      if (!audio.paused) return;
      if (audio.currentTime > 0) return;
      attempt(audio);
    }, TIMING.sound.retryMs),
  );
}

/* hooks.onLead fires TIMING.sound.leadMs before the end, hooks.onEnd just
   after it. */
function run(channel, src, hooks) {
  stopChannel(channel);

  const audio = clip(src);
  channel.voice = audio;
  play(channel, audio);

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

/* A new skill point, on its own channel: cues.js fires this as the plate goes
   up, by which time the dice are done with theirs. */
export function playPoint(onEnd) {
  run(channels.point, POINT_SRC, { onEnd: onEnd || null });
}

/* Experience that earned no point. The other half of the same plate, so it is
   never heard alongside the one above. */
export function playXp(onEnd) {
  run(channels.xp, XP_SRC, { onEnd: onEnd || null });
}

/* Money changing hands, fired by overlays.js as the notice goes up — never on
   the frame the wire said so, since the plate may still be queued behind the
   dice that earned it. */
export function playMoney(gained, onEnd) {
  run(channels.money, gained ? MONEY_SRC.gained : MONEY_SRC.lost, {
    onEnd: onEnd || null,
  });
}

/* One step of health or morale, fired the same way and for the same reason:
   the plate is what the sound belongs to, not the arithmetic. */
export function playVital(kind, gained, onEnd) {
  if (!own(VITAL_SRC, kind)) {
    if (onEnd) onEnd();
    return;
  }
  const pair = VITAL_SRC[kind];
  run(channels.vital, gained ? pair.gain : pair.loss, { onEnd: onEnd || null });
}

/* ---------------- The interface ---------------- */

/* A line taken. Nothing waits on it: the press is the player's own. */
export function playClick() {
  run(channels.ui, UI_SRC.click, { onEnd: null });
}

/* A dialog dismissed, whichever one it was — a third under the rest, since a
   panel closing is the least of what the interface says. clip() sets the
   level on every call, so this only ever holds for the one clip. */
export function playCancel() {
  run(channels.ui, UI_SRC.cancel, { onEnd: null });
  const voice = channels.ui.voice;
  if (voice) voice.volume = Math.max(0, TIMING.sound.volume * (2 / 3));
}

/* A dialog opened, whichever one it was: a switch thrown, answering the press
   that asked for it. */
export function playModal() {
  run(channels.ui, UI_SRC.modal, { onEnd: null });
}

/* The ready toggle, in either direction. The player's own hand on it, so it
   is heard on the frame it happens. */
export function playReady() {
  run(channels.ui, UI_SRC.ready, { onEnd: null });
}

/* A plan sent. Its own switch, so it is not mistaken for the ready one. */
export function playSend() {
  run(channels.ui, UI_SRC.send, { onEnd: null });
}

/* A skill card picked up in the sheet, and a point spent on one. Their own
   channel, so closing the dialog cannot cut a point short. */
export function playSkillPick() {
  run(channels.skill, UI_SRC.skillPick, { onEnd: null });
}

export function playSkillLevel() {
  run(channels.skill, UI_SRC.skillLevel, { onEnd: null });
}
