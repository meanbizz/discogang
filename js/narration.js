/* Narrator voice-over.

   One clip at a time, fetched from a text-to-speech API and played back on
   click. The same click while a line is loading or speaking cancels it: an
   in-flight request is aborted, a playing clip is paused and rewound.

   The caller gets its state back through a report callback — "loading",
   "playing", "idle" or "error" — so the button that started a line can paint
   itself without this module knowing anything about the DOM.

   Clips are held as blob URLs keyed by their text, so hearing the same line
   twice costs one request. Nothing here decides which lines are narrated;
   isNarrator answers that question for the reader, from the names in
   config.js. */

import { NARRATION } from "./config.js";

/* text → blob URL, oldest first for eviction. */
const clips = new Map();

/* The one line currently loading or speaking. */
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

/* A speaker is the narrator when the payload names it as one. */
export function isNarrator(speaker) {
  const name = normalize(speaker);
  if (!name) return false;
  return NARRATION.narratorNames.indexOf(name) !== -1;
}

export function isSpeaking(id) {
  return key === id;
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
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (error) {
      /* nothing to rewind */
    }
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

/* Resolves to a playable address. A line already heard resolves at once. */
function fetchClip(text, signal) {
  const held = clips.get(text);
  if (held) return Promise.resolve(held);

  const headers = {
    "Content-Type": "application/json",
  };
  if (NARRATION.token) headers.Authorization = "Bearer " + NARRATION.token;
  if (NARRATION.backend) headers.model = NARRATION.backend;

  const cleanedText = text.replaceAll("*", "");
  return fetch(NARRATION.endpoint, {
    method: "POST",
    mode: "cors",
    signal,
    headers,
    body: JSON.stringify({
      text: cleanedText,
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

function play(url, mine) {
  const voice = new Audio(url);
  voice.volume = NARRATION.volume;
  audio = voice;

  voice.onended = () => {
    if (key === mine) settle("idle");
  };
  voice.onerror = () => {
    if (key === mine) settle("error");
  };

  const started = voice.play();
  if (started && started.catch) {
    started.catch(() => {
      if (key === mine) settle("error");
    });
  }
  announce("playing");
}

/* Click to read a line aloud; click again to cancel it. id is whatever the
   caller uses to recognise its own line — the node id, in practice. */
export function toggle(id, text, report) {
  if (key === id) {
    stop();
    return;
  }
  stop();

  const body = String(text == null ? "" : text)
    .trim()
    .slice(0, NARRATION.maxChars);
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
      /* An abort has already handed the field over; anything else failed. */
      if (key !== mine) return;
      settle("error");
    });
}

/* Drops every held clip. */
export function reset() {
  stop();
  clips.forEach((url) => URL.revokeObjectURL(url));
  clips.clear();
}
