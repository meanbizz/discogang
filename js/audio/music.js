/* js/audio/music.js */

/* The music deck: a YouTube video played offscreen, held in step with the
   room by the startedAt the host hands out.

   Volume is this module's own business, and every change to it is a ramp: a
   track fades in, a track being replaced fades out before the next one is
   loaded, and a dice roll ducks whatever is playing and brings it back. All
   the durations come from TIMING.music.

   Readiness is deliberately paranoid. The iframe API is a classic script and
   this is a module, so the API can finish loading before the hook below is
   installed — in which case it is never called. Readiness is therefore also
   polled, and any hook already in place is kept. */

import { dom } from "../dom.js";
import { TIMING } from "../timing.js";
import * as volume from "./volume.js";

let youtubeReady = false;
let player = null;
let audioUnlocked = false;
let currentTrack = null;

/* The level the deck believes it is at, ramp in progress or not. */
let level = TIMING.music.volume;
let rampTimer = null;
let rampDone = null;
let duckTimer = null;
let pollTimer = null;
let pollTries = 0;

/* YT.PlayerState.ENDED, which is not to be relied on being loaded yet. */
const ENDED = 0;

function apiPresent() {
  return Boolean(window.YT && typeof window.YT.Player === "function");
}

const priorHook = window.onYouTubeIframeAPIReady;

function markApiReady() {
  if (youtubeReady || !apiPresent()) return;
  youtubeReady = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  /* A track that arrived before the API did gets its second chance here. */
  if (currentTrack) applyTrack(currentTrack);
}

window.onYouTubeIframeAPIReady = function () {
  if (typeof priorHook === "function") {
    try {
      priorHook();
    } catch (error) {
      /* not ours to care about */
    }
  }
  markApiReady();
};

/* Thirty seconds of asking, then the API is simply not coming. */
pollTimer = setInterval(() => {
  pollTries += 1;
  if (pollTries > 150) {
    clearInterval(pollTimer);
    pollTimer = null;
    return;
  }
  markApiReady();
}, 200);
markApiReady();

export function parseVideoId(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = value.match(patterns[i]);
    if (match) return match[1];
  }
  return null;
}

export function trackOffsetSeconds(track) {
  const elapsed = (Date.now() - Number(track.startedAt || Date.now())) / 1000;
  return elapsed > 1 ? Math.floor(elapsed) : 0;
}

export function describeTrack() {
  if (!dom.trackLabel) return;
  if (!currentTrack) {
    dom.trackLabel.textContent = "Silence.";
    return;
  }
  let title = "";
  if (player && player.getVideoData) {
    try {
      title = (player.getVideoData() || {}).title || "";
    } catch (error) {
      title = "";
    }
  }
  dom.trackLabel.textContent = title || currentTrack.videoId;
}

/* ---------------- Volume ---------------- */

function applyVolume(value) {
  level = Math.max(0, Math.min(100, value));
  if (!player || !player.setVolume) return;
  try {
    player.setVolume(Math.round(level * volume.scale("music")));
  } catch (error) {
    /* not ready */
  }
}

/* The deck is already where it asked to be, so a moved dial only means
   handing the player that same level again. */
volume.onChange(() => applyVolume(level));

function stopRamp() {
  if (rampTimer) {
    clearInterval(rampTimer);
    rampTimer = null;
  }
  rampDone = null;
}

/* One ramp at a time; a new one drops whatever the old one was going to do
   when it landed. */
function ramp(to, ms, done) {
  stopRamp();
  const from = level;
  const target = Math.max(0, Math.min(100, to));

  if (!ms || ms <= 0 || from === target) {
    applyVolume(target);
    if (done) done();
    return;
  }

  const startedAt = Date.now();
  rampDone = done || null;
  rampTimer = setInterval(() => {
    const passed = (Date.now() - startedAt) / ms;
    const share = passed > 1 ? 1 : passed;
    applyVolume(from + (target - from) * share);
    if (share < 1) return;
    const settle = rampDone;
    stopRamp();
    if (settle) settle();
  }, TIMING.music.stepMs);
}

/* Called on the frame a rolled node arrives: the deck gets out of the way of
   the dice. Safe to call with nothing playing. */
export function duck() {
  if (duckTimer) {
    clearTimeout(duckTimer);
    duckTimer = null;
  }
  ramp(TIMING.music.duckVolume, TIMING.music.duckOutMs);
}

/* Brings the deck back after delayMs, or straight away with 0. */
export function unduck(delayMs) {
  if (duckTimer) {
    clearTimeout(duckTimer);
    duckTimer = null;
  }
  const wait = Math.max(
    0,
    delayMs == null ? TIMING.music.duckHoldMs : delayMs,
  );
  duckTimer = setTimeout(() => {
    duckTimer = null;
    ramp(TIMING.music.volume, TIMING.music.duckInMs);
  }, wait);
}

/* ---------------- Unlock ---------------- */

/* Every seat can be blocked from autoplaying, not just the administrateur, so
   the button is offered to whoever still has silence they did not ask for.
   The argument is ignored and kept only for older callers. */
export function refreshAudioUnlockButton() {
  if (!dom.audioUnlock) return;
  dom.audioUnlock.hidden = !(currentTrack && !audioUnlocked);
}

export function markAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  refreshAudioUnlockButton();
  if (!player) return;
  try {
    if (player.unMute) player.unMute();
    applyVolume(level);
    if (currentTrack) player.playVideo();
  } catch (error) {
    /* not ready */
  }
}

/* ---------------- Playback ---------------- */

function startTrack(track) {
  /* A newer track may have arrived while the old one was fading out. */
  if (!player || !track || track !== currentTrack) return;

  applyVolume(TIMING.music.duckVolume);
  try {
    player.loadVideoById({
      videoId: track.videoId,
      startSeconds: trackOffsetSeconds(track),
    });
    if (audioUnlocked) player.unMute();
    else player.mute();
    player.playVideo();
  } catch (error) {
    /* not ready */
  }
  ramp(TIMING.music.volume, TIMING.music.fadeMs);
}

function createPlayer(track) {
  applyVolume(TIMING.music.duckVolume);
  player = new window.YT.Player("yt-player", {
    width: 1,
    height: 1,
    videoId: track.videoId,
    playerVars: {
      autoplay: 1,
      controls: 0,
      playsinline: 1,
      start: trackOffsetSeconds(track),
      origin: location.origin,
    },
    events: {
      onReady: (event) => {
        try {
          event.target.setVolume(0);
          if (audioUnlocked) event.target.unMute();
          else event.target.mute();
          event.target.playVideo();
        } catch (error) {
          /* not ready */
        }
        applyVolume(TIMING.music.duckVolume);
        ramp(TIMING.music.volume, TIMING.music.fadeMs);
        describeTrack();
        refreshAudioUnlockButton();
      },
      onStateChange: (event) => {
        describeTrack();
        if (event && event.data === ENDED) replayFromStart();
      },
      onError: () => {
        if (dom.deckError) {
          dom.deckError.textContent = "That video refused to play here.";
        }
      },
    },
  });
}

/* The track ran out and nothing newer was asked for, so it goes round again
   from the top at the level it was already playing at — a loop, not a fade. */
function replayFromStart() {
  if (!player || !currentTrack) return;
  try {
    player.seekTo(0, true);
    if (audioUnlocked) player.unMute();
    player.playVideo();
  } catch (error) {
    /* not ready */
  }
  applyVolume(level);
}

function fadeOutAndStop() {
  if (!player) return;
  ramp(TIMING.music.duckVolume, TIMING.music.fadeMs, () => {
    /* Something new may have been asked for mid-fade. */
    if (currentTrack) return;
    try {
      player.stopVideo();
    } catch (error) {
      /* nothing to stop */
    }
  });
}

export function applyTrack(track) {
  const previous = currentTrack;
  currentTrack = track || null;
  describeTrack();
  refreshAudioUnlockButton();

  if (!currentTrack) {
    fadeOutAndStop();
    return;
  }
  /* markApiReady replays this once the API turns up. */
  if (!apiPresent()) return;

  if (!player) {
    createPlayer(currentTrack);
    return;
  }

  const swapping = Boolean(
    previous && previous.videoId !== currentTrack.videoId,
  );
  if (swapping) {
    /* The old track leaves before the new one arrives. */
    ramp(TIMING.music.duckVolume, TIMING.music.fadeMs, () => {
      startTrack(currentTrack);
    });
    return;
  }
  startTrack(currentTrack);
}

/* Back in step with the room — what the unlock button asks for. */
export function resync() {
  if (!currentTrack) return;
  if (!player) {
    applyTrack(currentTrack);
    return;
  }
  try {
    player.seekTo(trackOffsetSeconds(currentTrack), true);
    if (audioUnlocked) player.unMute();
    player.playVideo();
  } catch (error) {
    /* not ready */
  }
  refreshAudioUnlockButton();
}

export function stopPlayer() {
  stopRamp();
  if (duckTimer) {
    clearTimeout(duckTimer);
    duckTimer = null;
  }
  currentTrack = null;
  if (player && player.stopVideo) {
    try {
      player.stopVideo();
    } catch (error) {
      /* nothing to stop */
    }
  }
  applyVolume(TIMING.music.volume);
  describeTrack();
  refreshAudioUnlockButton();
}

export function getCurrentTrack() {
  return currentTrack;
}

export function getPlayer() {
  return player;
}
