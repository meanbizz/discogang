/* js/app/state.js */

/* The session's shared state and the small readings taken from it. Nothing
   here touches the DOM or the network.

   Two host-side memories live here beside the roster: seats, which is what
   lets a player who lost their wire sit back down with the slot and the
   progress they had, and savedProgress, which is a loaded save's record of
   people who have not arrived yet. */

import { PLAYER_SLOTS } from "../config.js";
import { cleanName, cleanText, uid } from "../utils.js";
import { cleanScores, cleanAllocated } from "../sheet.js";
import { cleanXpLedger } from "../xp.js";

export const state = {
  isAdmin: false,
  roster: new Map(),
  logEntries: [],
  turnEntries: [],
  npcs: [],
  /* Every item the game knows: name, image, description. */
  items: [],
  /* Who carries what: character name -> { item name: count }. */
  inventories: {},
  /* What each character is after: character name -> [ goal ]. */
  goals: {},
  selfReady: false,
  profile: { name: "", portrait: null },
  roomId: "",
  scene: { image: null },
  /* Skill art shown while a dialogue node is speaking. */
  sceneOverride: null,
  stagedPortrait: null,
  stagedSheet: null,
  sheetState: null,
  dialoguePayload: null,
  /* Every round sent this session, oldest first. */
  dialogueRounds: [],
  dialogueLive: false,
  /* Whether this seat has already been welcomed into the room. A wire that
     comes back is welcomed again, and a second welcome must not rebuild the
     scene the player is in the middle of reading. */
  welcomed: false,
  /* A save is read once per session; this remembers that it happened. */
  sessionRestored: false,
  /* Host only. Lowercased name -> what that seat had when it went quiet. */
  seats: new Map(),
  /* Host only. Lowercased name -> the progress a loaded save recorded. */
  savedProgress: new Map(),
};

export function rosterPayload() {
  const people = [];
  state.roster.forEach((person) => people.push(person));
  return { type: "roster", people };
}

/* ---------------- Progress, as it travels ---------------- */

/* One person's experience and skills, rebuilt. Everything is optional: a
   player with no sheet reports nothing, and that is not an error. */
export function cleanProgress(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { skills: {}, allocated: {}, xp: null };
  }
  return {
    skills: cleanScores(raw.skills),
    allocated: cleanAllocated(raw.allocated),
    xp: cleanXpLedger(raw.xp),
  };
}

function seatKey(name) {
  return cleanName(name).toLowerCase();
}

/* ---------------- Seat memory (host only) ---------------- */

/* Called as a peer drops. A dropped wire is not a player leaving the table,
   so what they had is kept for whoever answers to that name next. */
export function rememberSeat(person) {
  if (!person || person.admin) return;
  const key = seatKey(person.name);
  if (!key) return;
  state.seats.set(key, {
    slot: person.slot || 0,
    ready: Boolean(person.ready),
    done: Boolean(person.done),
    skills: person.skills || {},
    allocated: person.allocated || {},
    xp: person.xp || null,
    at: Date.now(),
  });
}

export function recallSeat(name) {
  const key = seatKey(name);
  return key ? state.seats.get(key) || null : null;
}

/* ---------------- Restored progress (host only) ---------------- */

export function rememberProgress(people) {
  state.savedProgress.clear();
  (Array.isArray(people) ? people : []).forEach((person) => {
    if (!person || person.admin) return;
    const key = seatKey(person.name);
    if (!key) return;
    state.savedProgress.set(key, {
      skills: person.skills || {},
      allocated: person.allocated || {},
      xp: person.xp || null,
    });
  });
}

export function recallProgress(name) {
  const key = seatKey(name);
  return key ? state.savedProgress.get(key) || null : null;
}

/* ---------------- Tallies ---------------- */

export function countReady() {
  let players = 0;
  let readied = 0;
  state.roster.forEach((person) => {
    if (person.admin) return;
    players += 1;
    if (person.ready) readied += 1;
  });
  return { players, readied };
}

export function everyoneReady() {
  const tally = countReady();
  return tally.players > 0 && tally.readied === tally.players;
}

export function countScene() {
  let players = 0;
  let done = 0;
  state.roster.forEach((person) => {
    if (person.admin) return;
    players += 1;
    if (person.done) done += 1;
  });
  return { players, done };
}

export function slotOf(personId, authorName) {
  let found = personId ? state.roster.get(personId) : null;
  if (!found) {
    state.roster.forEach((candidate) => {
      if (!found && !candidate.admin && candidate.name === authorName) {
        found = candidate;
      }
    });
  }
  return found && found.slot ? found.slot : 0;
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw.text !== "string") return null;
  const text = cleanText(raw.text);
  if (!text) return null;
  return {
    id: raw.id || uid(),
    author: cleanName(raw.author) || "Unnamed",
    authorId: typeof raw.authorId === "string" ? raw.authorId : "",
    text,
    at: Number(raw.at) || Date.now(),
    system: Boolean(raw.system),
    /* Plans from a scene that has already played out stay faded. */
    stale: Boolean(raw.stale),
    /* Set on the last plan of a round as it closes. */
    roundEnd: Boolean(raw.roundEnd),
    /* A restored round's marker keeps its name wherever it travels. */
    roundId: typeof raw.roundId === "string" ? raw.roundId.slice(0, 64) : "",
  };
}

export { PLAYER_SLOTS };
