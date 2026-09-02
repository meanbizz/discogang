/* js/export/session.js */

/* Session saves: one JSON document holding what a room has said, planned and
   drawn, every dialogue payload sent this session, every item in play, and
   what each player has earned.

   A save is untrusted input whoever wrote it, so every field is rebuilt here.
   Deliberately absent: the music track, whose startedAt means nothing hours
   later, and the live peer ids. Nothing here touches the network or the log. */

import { HISTORY_LIMIT, TURN_LIMIT, PLAYER_SLOTS } from "../config.js";
import {
  uid,
  cleanName,
  cleanText,
  cleanImageUrl,
  cleanScene,
  cleanNpc,
  sanitizeRoomCode,
} from "../utils.js";
import { cleanPayload } from "../dialogue/sanitize.js";
import { cleanItems, cleanInventories } from "../inventory/items.js";
import { cleanGoalBooks } from "../goals/goals.js";
import { cleanScores, cleanAllocated } from "../sheet.js";
import { cleanXpLedger } from "../xp.js";
import { cleanRounds, latestPayload, ROUND_ID_MAX } from "./rounds.js";

export const SESSION_KIND = "salon-session";
/* 5 added each player's goals; 4 added the experience ledger. Older saves
   still load: whatever they never recorded simply starts from nothing. */
export const SESSION_VERSION = 5;

const MAX_PEOPLE = 32;
const MAX_NPCS = 64;
const STAMP_MAX = 40;

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
    stale: Boolean(raw.stale),
    /* The last plan of a closed round is what the plan log rules off under. */
    roundEnd: Boolean(raw.roundEnd),
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

/* A saved peer id means nothing in a later session, but a name still does —
   the app uses these to hand returning players their old colour, their bags,
   and now their experience.

   skills is the reading the administrateur imports; allocated is the half that
   is actually given back, since the attributes come from whatever sheet the
   player walks in with. */
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
    skills: cleanScores(raw.skills),
    allocated: cleanAllocated(raw.allocated),
    xp: cleanXpLedger(raw.xp),
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

/* Everything the app holds, put through the same sieve a loaded file goes
   through, so a save can never carry a shape the reader would refuse. */
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
    items: cleanItems(source.items),
    inventories: cleanInventories(source.inventories),
    goals: cleanGoalBooks(source.goals),
    scene: cleanScene(source.scene),
    rounds,
    dialogue: cleanPayload(source.dialogue) || latestPayload(rounds),
  };
}

/* The one door a save comes through, from a file picker or from the
   administrateur over the wire. */
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
    /* Empty for any save written before items were kept. */
    items: cleanItems(raw.items),
    inventories: cleanInventories(raw.inventories),
    /* Empty for any save written before goals were kept. */
    goals: cleanGoalBooks(raw.goals),
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
