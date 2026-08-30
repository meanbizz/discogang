import { dom } from "./dom.js";

let youtubeReady = false;
let player = null;
let audioUnlocked = false;
let currentTrack = null;

window.onYouTubeIframeAPIReady = function () {
  youtubeReady = true;
  if (currentTrack) applyTrack(currentTrack);
};

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

export function refreshAudioUnlockButton(isAdmin) {
  if (!dom.audioUnlock) return;
  dom.audioUnlock.hidden = !(isAdmin && currentTrack && !audioUnlocked);
}

export function markAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  refreshAudioUnlockButton(false);
  if (player && player.unMute) {
    try {
      player.unMute();
      player.setVolume(45);
      if (currentTrack) player.playVideo();
    } catch (error) {
      /* not ready */
    }
  }
}

export function applyTrack(track, isAdmin) {
  currentTrack = track || null;
  describeTrack();
  refreshAudioUnlockButton(isAdmin);

  if (!currentTrack) {
    if (player && player.stopVideo) {
      try {
        player.stopVideo();
      } catch (error) {}
    }
    return;
  }
  if (!youtubeReady || typeof YT === "undefined" || !YT.Player) return;

  const offset = trackOffsetSeconds(currentTrack);

  if (!player) {
    player = new YT.Player("yt-player", {
      width: 1,
      height: 1,
      videoId: currentTrack.videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        playsinline: 1,
        start: offset,
        origin: location.origin,
      },
      events: {
        onReady: (event) => {
          event.target.setVolume(45);
          if (audioUnlocked) event.target.unMute();
          else event.target.mute();
          event.target.playVideo();
          describeTrack();
        },
        onStateChange: describeTrack,
        onError: () => {
          if (dom.deckError)
            dom.deckError.textContent = "That video refused to play here.";
        },
      },
    });
    return;
  }

  player.loadVideoById({
    videoId: currentTrack.videoId,
    startSeconds: offset,
  });
  if (audioUnlocked) player.unMute();
  player.playVideo();
}

export function stopPlayer() {
  if (player && player.stopVideo) {
    try {
      player.stopVideo();
    } catch (e) {}
  }
  currentTrack = null;
}

export function getCurrentTrack() {
  return currentTrack;
}

export function getPlayer() {
  return player;
}
