/* Narrator voice-over: one clip at a time, fetched from a speech API and
   played on click. The same click while loading or speaking cancels it.

   The caller gets its state back through a report callback — "loading",
   "playing", "idle", "error" — so a button can paint itself without this
   module knowing any DOM. Clips are held as blob URLs keyed by their text.
   canNarrate answers who is offered aloud; config and the app name who is not.

   What is spoken is not quite what is written: *styled* passages are stage
   directions rather than speech, so they are cut out before anything is
   fetched. See speakable. */

import { NARRATION } from "../config.js";
import { halt, start } from "./channel.js";
import * as volume from "./volume.js";

const clips = new Map();

let key = null;
let audio = null;
let controller = null;
let onState = null;

function announce(state) {
  if (onState) onState(state);
}

function normalize(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* Never read aloud: the two inner voices from config, plus whoever the app
   adds — minted NPCs and every player at the table. */
let excluded = new Set((NARRATION.excludedNames || []).map(normalize));

export function setNarrationExclusions(names) {
  excluded = new Set((NARRATION.excludedNames || []).map(normalize));
  (Array.isArray(names) ? names : []).forEach((name) => {
    const key = normalize(name);
    if (key) excluded.add(key);
  });
}

export function canNarrate(speaker) {
  const name = normalize(speaker);
  return Boolean(name) && !excluded.has(name);
}

/* Auto mode: new scenes ask for their own readings as each line is reached. */
let auto = false;

export function autoNarrate() {
  return auto;
}

export function setAutoNarrate(next) {
  auto = Boolean(next);
  if (!auto) stop();
}

export function isSpeaking(id) {
  return key === id;
}

/* *like this* is style, not speech: the asterisks and everything between them
   are dropped rather than read out. An asterisk with no partner takes the rest
   of the line with it, so a half-written aside cannot be narrated either.

   The tidying afterwards is what keeps the cut from being audible: doubled
   spaces close up, and punctuation left stranded by the removal rejoins the
   word before it. Because this runs before the cache key is taken, two lines
   that differ only in their styling share one clip. */
export function speakable(value) {
  return String(value == null ? "" : value)
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\*[^*]*$/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/* Hands the field back: whatever was active is dropped and told so. */
function settle(state) {
  const report = onState;
  key = null;
  audio = null;
  controller = null;
  onState = null;
  if (report) report(state);
}

export function stop() {
  if (controller) {
    try {
      controller.abort();
    } catch (error) {
      /* already finished */
    }
  }
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    halt(audio);
  }
  settle("idle");
}

function remember(text, url) {
  if (clips.size >= NARRATION.cacheLimit) {
    const oldest = clips.keys().next().value;
    const stale = clips.get(oldest);
    if (stale) URL.revokeObjectURL(stale);
    clips.delete(oldest);
  }
  clips.set(text, url);
}

function fetchClip(text, signal) {
  const held = clips.get(text);
  if (held) return Promise.resolve(held);

  const headers = { "Content-Type": "application/json" };
  if (NARRATION.token) headers.Authorization = "Bearer " + NARRATION.token;
  if (NARRATION.backend) headers.model = NARRATION.backend;

  return fetch(NARRATION.endpoint, {
    method: "POST",
    mode: "cors",
    signal,
    headers,
    body: JSON.stringify({
      /* Already stripped by speakable — nothing to undo here. */
      text,
      reference_id: NARRATION.modelId,
      format: NARRATION.format,
      normalize: true,
      latency: "normal",
    }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("tts refused: " + response.status);
      return response.blob();
    })
    .then((blob) => {
      if (!blob || !blob.size) throw new Error("empty clip");
      const url = URL.createObjectURL(blob);
      remember(text, url);
      return url;
    });
}

/* Ask for a clip without playing it, so a line being walked towards is
   already in memory when the player arrives. */
export function prefetch(text) {
  const body = speakable(text).slice(0, NARRATION.maxChars);
  if (!body || clips.has(body)) return;
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  fetchClip(body, controller ? controller.signal : undefined).catch(() => {});
}

/* A dial moved mid-line: the clip in hand follows it rather than waiting for
   the next one. */
volume.onChange(() => {
  if (audio) audio.volume = volume.apply("narration", NARRATION.volume);
});

function play(url, mine) {
  const voice = new Audio(url);
  voice.volume = volume.apply("narration", NARRATION.volume);
  audio = voice;

  voice.onended = () => {
    if (key === mine) settle("idle");
  };
  voice.onerror = () => {
    if (key === mine) settle("error");
  };

  const started = start(voice);
  if (started && started.catch) {
    started.catch(() => {
      if (key === mine) settle("error");
    });
  }
  announce("playing");
}

/* Click to read a line aloud, click again to cancel. id is whatever the
   caller uses to recognise its own line. A line that is nothing but style has
   nothing to say, so it settles straight back to idle. */
export function toggle(id, text, report) {
  if (key === id) {
    stop();
    return;
  }
  stop();

  const body = speakable(text).slice(0, NARRATION.maxChars);
  if (!body) {
    if (report) report("idle");
    return;
  }

  key = id;
  onState = report || null;
  announce("loading");

  controller =
    typeof AbortController === "function" ? new AbortController() : null;

  const mine = id;
  fetchClip(body, controller ? controller.signal : undefined)
    .then((url) => {
      if (key !== mine) return;
      controller = null;
      play(url, mine);
    })
    .catch(() => {
      if (key !== mine) return;
      settle("error");
    });
}

export function reset() {
  stop();
  clips.forEach((url) => URL.revokeObjectURL(url));
  clips.clear();
}
