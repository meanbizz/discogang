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

   endpoint is the text-to-speech service; modelId is the voice it speaks
   with. narratorNames are the speaker names, lowercased, that earn a line its
   play button.

   The token below is readable by anyone who loads this page. Point endpoint
   at a server of your own that holds the key instead, and leave token empty,
   the moment this is more than a private table. */
export const NARRATION = {
  endpoint: "https://api.fish.audio/v1/tts",
  token: "sk-fish-PHhjnnF26J603vHKzCZSkahuCVZ61N-JrVZQ8em4aaU",
  modelId: "dce36baf20c14deb95d7377a2d661b4c",
  backend: "speech-1.6",
  format: "mp3",
  volume: 0.9,
  maxChars: 2000,
  cacheLimit: 24,
  narratorNames: ["narrator", "narrateur", "the narrator", "le narrateur"],
};
