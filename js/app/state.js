/* js/app/state.js */

/* The session's shared state and the small readings taken from it. Nothing
   here touches the DOM or the network. */

import { PLAYER_SLOTS } from "../config.js";
import { cleanName, cleanText, uid } from "../utils.js";

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
  /* A save is read once per session; this remembers that it happened. */
  sessionRestored: false,
};

export function rosterPayload() {
  const people = [];
  state.roster.forEach((person) => people.push(person));
  return { type: "roster", people };
}

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
