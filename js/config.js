export const ROOM_PREFIX = "de-salon-";
export const ADMIN_NAME = "administrateur";
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_NAME_LENGTH = 24;
export const HISTORY_LIMIT = 200;
export const TURN_LIMIT = 120;
export const TURN_MIN_LENGTH = 3;
export const PLAYER_SLOTS = 8;

export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const ROOM_CODE_MIN = 4;
export const ROOM_CODE_MAX = 32;

export const STATS_MAX_BYTES = 256 * 1024;
export const VITAL_SKILL = { health: "endurance", morale: "volition" };

export const IMAGE_HOST = {
  cloudName: "w9puemf3",
  uploadPreset: "portraits",
};

export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_URL_MAX_CHARS = 2048;

export const MAX_JOIN_ATTEMPTS = 4;
export const RETRY_DELAY_MS = 1200;

/* Narrator voice-over.

   endpoint is the Cloudflare Worker that fronts the speech service; it holds
   the key and sends the CORS headers the browser insists on, so token and
   backend stay empty here. Emptying them is not cosmetic: it keeps the
   Authorization and model headers off the request, which is what keeps the
   preflight to content-type alone.

   modelId is the voice, and travels in the body as reference_id — the Worker
   passes the body through untouched, so changing a voice is a change here and
   nowhere else.

   narratorNames are the speaker names, lowercased, that earn a line its play
   button. */
export const NARRATION = {
  endpoint: "https://fish-tts.segalyair11.workers.dev/",
  token: "",
  backend: "",
  modelId: "dce36baf20c14deb95d7377a2d661b4c",
  format: "mp3",
  volume: 0.9,
  maxChars: 2000,
  cacheLimit: 24,
  narratorNames: ["narrator", "narrateur", "the narrator", "le narrateur"],
};
