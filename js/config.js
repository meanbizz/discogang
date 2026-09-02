/* Every tunable number and name the session runs on. */

import { NARRATION_ENDPOINT } from "./secrets/secrets.js";

export const ROOM_PREFIX = "de-salon-";
export const ADMIN_NAME = "administrateur";
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_NAME_LENGTH = 24;
export const HISTORY_LIMIT = 200;
export const TURN_LIMIT = 120;
export const TURN_MIN_LENGTH = 3;
export const PLAYER_SLOTS = 8;
/* Rounds held for the save: oldest dropped first. Each round carries every
   character's tree, so this is the table's whole dialogue history. */
export const DIALOGUE_ROUND_LIMIT = 64;

export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const ROOM_CODE_MIN = 4;
export const ROOM_CODE_MAX = 32;

export const STATS_MAX_BYTES = 256 * 1024;
export const VITAL_SKILL = { health: "endurance", morale: "volition" };

/* Experience. A skill point costs XP_PER_POINT; the two ceilings are there so
   a payload cannot hand somebody a number nothing can print. */
export const XP_PER_POINT = 100;
export const XP_MAX_PER_NODE = 10000;
export const XP_MAX_TOTAL = 1000000;

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

/* Keeping the wire alive.

   PEER_PING_MS is how often PeerJS pings the signalling socket. It is set
   explicitly because the default is slack enough that a backgrounded tab —
   whose timers the browser throttles to roughly one a minute — misses the
   server's idle window and has its socket reaped. That is the usual reason a
   room dies after a quarter of an hour.

   KEEPALIVE_MS is our own ping across every open data connection: it keeps
   idle NAT mappings from being collected and gives each end something to
   measure silence against. LINK_STALE_MS is how much silence condemns a link;
   LINK_WATCH_MS is how often the watchdog looks, though it also runs the
   moment the tab is looked at, since a hidden tab's timers cannot be trusted.

   MAX_RESUME_ATTEMPTS is how many times a guest re-dials a host it has lost
   before calling the room closed, the delay growing to RESUME_MAX_DELAY_MS.
   The reclaim pair is the host's side of the same idea: how many times it
   tries to take its own room id back from the signalling server. */
export const PEER_PING_MS = 3000;
export const KEEPALIVE_MS = 15000;
export const LINK_WATCH_MS = 5000;
export const LINK_STALE_MS = 45000;
export const MAX_RESUME_ATTEMPTS = 12;
export const RESUME_DELAY_MS = 1500;
export const RESUME_MAX_DELAY_MS = 15000;
export const MAX_RECLAIM_ATTEMPTS = 8;
export const RECLAIM_DELAY_MS = 2500;

/* endpoint is the Worker that holds the speech key and sends the CORS
   headers; token and backend stay empty so the preflight is content-type
   alone. modelId travels in the body as reference_id. narratorNames are the
   speaker names, lowercased, that earn a line its play button. */
export const NARRATION = {
  endpoint: NARRATION_ENDPOINT,
  token: "",
  backend: "",
  modelId: "dce36baf20c14deb95d7377a2d661b4c",
  format: "mp3",
  volume: 0.9,
  maxChars: 2000,
  cacheLimit: 24,
  narratorNames: ["narrator", "narrateur", "the narrator", "le narrateur"],
};
