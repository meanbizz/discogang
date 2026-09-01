/* Narrator voice-over: one clip at a time, fetched from a speech API and
   played on click. The same click while loading or speaking cancels it.

   The caller gets its state back through a report callback — "loading",
   "playing", "idle", "error" — so a button can paint itself without this
   module knowing any DOM. Clips are held as blob URLs keyed by their text.
   isNarrator answers which speakers are offered aloud, from config.js. */

import { NARRATION } from "../config.js";
import { halt, start } from "./channel.js";

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
      text: text.replaceAll("*", ""),
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

  const started = start(voice);
  if (started && started.catch) {
    started.catch(() => {
      if (key === mine) settle("error");
    });
  }
  announce("playing");
}

/* Click to read a line aloud, click again to cancel. id is whatever the
   caller uses to recognise its own line. */
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
      if (key !== mine) return;
      settle("error");
    });
}

export function reset() {
  stop();
  clips.forEach((url) => URL.revokeObjectURL(url));
  clips.clear();
}
