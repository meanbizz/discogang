/* Session save files.

   One JSON document holding what a room has said, planned and drawn: the
   session log, the plan log, the NPCs, the scene image, and every dialogue
   payload the administrateur has sent this session. The administrateur writes
   one out with Export and reads one back with Load.

   The dialogue history is the reason a save is worth keeping. rounds is the
   whole run in order, each entry one payload with every character's tree
   inside it; dialogue alongside it is only the round that was live when the
   file was written, kept so the reader has an obvious "current" without
   walking the list.

   A save is untrusted input whoever wrote it, so everything read from a file
   is rebuilt field by field here — the same treatment anything crossing the
   wire gets in dialogue.js. Deliberately absent: the music track, whose
   startedAt would be meaningless hours later, and the live peer ids, which
   are new every session.

   Nothing here touches the network or the log; main.js decides what to do
   with a snapshot once it holds one. The only DOM this file knows about is
   the throwaway anchor a download needs. */

import {
  HISTORY_LIMIT,
  TURN_LIMIT,
  PLAYER_SLOTS,
  DIALOGUE_ROUND_LIMIT,
} from "./config.js";
import {
  uid,
  cleanName,
  cleanText,
  cleanImageUrl,
  cleanScene,
  sanitizeRoomCode,
} from "./utils.js";
import { cleanPayload } from "./dialogue.js";
import { cleanNpc } from "./modals.js";

export const SESSION_KIND = "salon-session";
export const SESSION_VERSION = 2;

/* A full history of rounds is the bulk of a save, and each payload is allowed
   200k characters of its own, so the ceiling here is generous on purpose. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PEOPLE = 32;
const MAX_NPCS = 64;
const STAMP_MAX = 40;
const ROUND_ID_MAX = 64;

/* ---------------- Field by field ---------------- */

function cleanEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = cleanText(raw.text);
  if (!text) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    author: cleanName(raw.author) || "Unnamed",
    authorId: typeof raw.authorId === "string" ? raw.authorId : "",
    text,
    at: Number(raw.at) || Date.now(),
    system: Boolean(raw.system),
    /* Plans from an earlier scene keep their faded standing. */
    stale: Boolean(raw.stale),
    /* And the round boundaries keep their place: the last plan of a closed
       round is what the plan log rules off under, so a restored run still
       shows where one round ended and the next began. */
    roundEnd: Boolean(raw.roundEnd),
    /* A restored round's marker names the round it stands for, so restoring a
       save that already holds one does not write it a second time. */
    roundId:
      typeof raw.roundId === "string" ? raw.roundId.slice(0, ROUND_ID_MAX) : "",
  };
}

function cleanEntries(raw, limit) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < limit; i += 1) {
    const entry = cleanEntry(raw[i]);
    if (entry) out.push(entry);
  }
  return out;
}

/* Names, portraits and slot numbers only: a saved peer id means nothing in a
   later session, but a name still does — main.js uses these to hand returning
   players their old colour. */
function cleanPerson(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  let slot = Number(raw.slot) || 0;
  if (slot < 0 || slot > PLAYER_SLOTS) slot = 0;
  return {
    name,
    portrait: cleanImageUrl(raw.portrait),
    admin: Boolean(raw.admin),
    slot,
  };
}

function cleanPeople(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_PEOPLE; i += 1) {
    const person = cleanPerson(raw[i]);
    if (person) out.push(person);
  }
  return out;
}

function cleanNpcs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_NPCS; i += 1) {
    const npc = cleanNpc(raw[i]);
    if (npc) out.push(npc);
  }
  return out;
}

/* ---------------- Dialogue history ---------------- */

/* One round: the id it was published under, when, and every character's tree
   as that round sent them. The payload goes through dialogue.js untouched, so
   a round can only ever hold shapes the reader already understands. */
function cleanRound(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = cleanPayload(raw.payload);
  if (!payload) return null;
  return {
    id:
      typeof raw.id === "string" && raw.id
        ? raw.id.slice(0, ROUND_ID_MAX)
        : uid(),
    at: Number(raw.at) || 0,
    payload,
  };
}

/* The oldest rounds fall off the front, so a save always holds the most
   recent DIALOGUE_ROUND_LIMIT of them.

   fallback is for version 1 saves and for any peer that only ever knew the
   live payload: a lone payload becomes the single round of its history rather
   than being dropped. */
export function cleanRounds(raw, fallback) {
  const out = [];
  if (Array.isArray(raw)) {
    const source =
      raw.length > DIALOGUE_ROUND_LIMIT ? raw.slice(-DIALOGUE_ROUND_LIMIT) : raw;
    for (let i = 0; i < source.length; i += 1) {
      const round = cleanRound(source[i]);
      if (round) out.push(round);
    }
  }
  if (out.length) return out;

  const single = cleanPayload(fallback);
  return single ? [{ id: uid(), at: 0, payload: single }] : [];
}

/* The payload of the last round held, for a caller that wants a "current"
   without reaching into the list. */
export function latestPayload(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) return null;
  const last = rounds[rounds.length - 1];
  return last && last.payload ? last.payload : null;
}

/* ---------------- Writing ---------------- */

/* Everything main.js holds, put through the same sieve a loaded file goes
   through — so a save can never carry a shape the reader would refuse. */
export function snapshot(state) {
  const source = state || {};
  const rounds = cleanRounds(source.rounds, source.dialogue);
  return {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    room: sanitizeRoomCode(source.room),
    people: cleanPeople(source.people),
    entries: cleanEntries(source.entries, HISTORY_LIMIT),
    turns: cleanEntries(source.turns, TURN_LIMIT),
    npcs: cleanNpcs(source.npcs),
    scene: cleanScene(source.scene),
    rounds,
    dialogue: cleanPayload(source.dialogue) || latestPayload(rounds),
  };
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes())
  );
}

export function fileName(snap) {
  const room = snap && snap.room ? snap.room : "session";
  return "salon-" + room + "-" + stamp() + ".json";
}

/* Returns whether the browser took the download. */
export function download(snap) {
  let url = null;
  try {
    const body = JSON.stringify(snap, null, 2);
    const blob = new Blob([body], { type: "application/json" });
    url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(snap);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    /* The click is asynchronous; the address has to outlive this tick. */
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}

/* ---------------- Reading ---------------- */

/* The one door a save comes through, whether it arrived from a file picker or
   from the administrateur over the wire. */
export function clean(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.kind && raw.kind !== SESSION_KIND) return null;

  const rounds = cleanRounds(raw.rounds, raw.dialogue);
  return {
    kind: SESSION_KIND,
    version: Number(raw.version) || SESSION_VERSION,
    savedAt:
      typeof raw.savedAt === "string" ? raw.savedAt.slice(0, STAMP_MAX) : "",
    room: sanitizeRoomCode(raw.room),
    people: cleanPeople(raw.people),
    entries: cleanEntries(raw.entries, HISTORY_LIMIT),
    turns: cleanEntries(raw.turns, TURN_LIMIT),
    npcs: cleanNpcs(raw.npcs),
    scene: cleanScene(raw.scene),
    rounds,
    dialogue: cleanPayload(raw.dialogue) || latestPayload(rounds),
  };
}

/* Returns { session, error }; exactly one of the two is set. */
export function parse(text) {
  const body = String(text == null ? "" : text).trim();
  if (!body || body.charAt(0) !== "{") {
    return { session: null, error: "That file is not a session save." };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return { session: null, error: "That save is not valid JSON." };
  }

  const cleaned = clean(parsed);
  if (!cleaned) {
    return { session: null, error: "That JSON was not written by this room." };
  }
  return { session: cleaned, error: null };
}

/* done(session, error) — one argument is always null. */
export function readFile(file, done) {
  if (!file) {
    done(null, "No file was chosen.");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    done(null, "That save is too large to read.");
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => done(null, "That file could not be read.");
  reader.onload = () => {
    const attempt = parse(String(reader.result));
    done(attempt.session, attempt.error);
  };
  reader.readAsText(file);
}
