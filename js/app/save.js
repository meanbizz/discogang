/* js/app/save.js */

/* Export and Load, from the room's side: what a snapshot is written from, and
   what happens to a room when one is read back.

   A save carries each player's experience and the skill points they had spent,
   so a campaign picked up next week is not picked up at zero. Restoring them
   is per-seat: the host holds the record and hands each name its own half,
   because nobody else's ledger is any seat's business. */

import { dom } from "../dom.js";
import * as session from "../export/session.js";
import { download } from "../export/file.js";
import { latestPayload } from "../export/rounds.js";
import * as dialogue from "../dialogue/dialogue.js";
import { cleanName } from "../utils.js";
import {
  state,
  normalizeEntry,
  rosterPayload,
  rememberProgress,
  recallProgress,
} from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { renderRoster, replaceLog, replaceTurnLog } from "./views.js";
import {
  loadAllowed,
  refreshLoadButton,
  refreshPlanningLock,
  refreshSpeakLock,
} from "./locks.js";
import { applyScene, setNpcs } from "./scene.js";
import { setInventory } from "./inventory.js";
import { setGoals } from "./goals.js";
import { setStatusRolls } from "./status.js";
import { adoptProgress } from "./progress.js";
import { replaceRounds, showDialogueHistory } from "./rounds.js";

let noteTimer = null;

export function noteSession(text) {
  if (!dom.sessionNote) return;
  dom.sessionNote.textContent = text;
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    dom.sessionNote.textContent = "";
  }, 4000);
}

export function exportSession() {
  if (!state.isAdmin) return;

  const people = [];
  state.roster.forEach((person) => people.push(person));

  const snap = session.snapshot({
    room: state.roomId,
    people,
    entries: state.logEntries,
    turns: state.turnEntries,
    npcs: state.npcs,
    items: state.items,
    inventories: state.inventories,
    goals: state.goals,
    down: state.down,
    kia: state.kia,
    scene: state.scene,
    dialogue: state.dialoguePayload,
    rounds: state.dialogueRounds,
  });

  noteSession(
    download(snap)
      ? "Session written to a save file."
      : "That save could not be written.",
  );
}

/* Returning players get their old colour back by name — the peer ids in a
   save are long dead. Host only: slots are the host's to hand out. */
function restoreSlots(people) {
  if (!network.isHost || !Array.isArray(people) || !people.length) return;

  let touched = false;
  people.forEach((saved) => {
    if (saved.admin || !saved.slot) return;
    state.roster.forEach((person) => {
      if (person.admin || person.name !== saved.name) return;
      if (person.slot === saved.slot) return;
      person.slot = saved.slot;
      touched = true;
    });
  });

  if (!touched) return;
  renderRoster();
  broadcast(rosterPayload());
}

/* Host only: everybody already in the room who the save has something to say
   about is handed their own half of it, and nobody is handed anybody else's.
   Whoever arrives later gets theirs in their welcome. */
function restoreProgress(people) {
  if (!network.isHost) return;
  rememberProgress(people);

  state.roster.forEach((person) => {
    if (person.admin) return;
    const held = recallProgress(person.name);
    if (!held) return;

    person.skills = held.skills || {};
    person.allocated = held.allocated || {};
    person.xp = held.xp || null;

    if (person.id === network.selfId) {
      /* The host is a player too, when they are not the administrateur. */
      adoptProgress(held);
      return;
    }
    const conn = network.downstream.get(person.id);
    if (conn && conn.open) {
      try {
        conn.send({ type: "progress-restore", progress: held });
      } catch (error) {}
    }
  });
}

/* Every plan in a save belongs to a round that is already over. They come
   back faded so the next Import cannot pick them up, and the last of them
   carries the rule separating the restored run from what is planned next. */
function restoredTurns(entries) {
  entries.forEach((entry) => {
    entry.stale = true;
  });
  const last = entries[entries.length - 1];
  if (last) last.roundEnd = true;
  return entries;
}

/* This seat's own half of a save, when it is not the host handing it out: a
   guest administrateur loads a file and applies it locally too. */
function restoreSelf(people) {
  if (network.isHost || state.isAdmin) return;
  const wanted = cleanName(state.profile.name).toLowerCase();
  if (!wanted) return;
  (Array.isArray(people) ? people : []).forEach((saved) => {
    if (saved.admin || cleanName(saved.name).toLowerCase() !== wanted) return;
    adoptProgress(saved);
  });
}

/* Everyone's side of a restore. Nothing replays: the reader stays closed and
   planning stays open, since a save holds no record of who had already read
   their scene — which is also why this may only happen once.

   The purse comes back as it was written, and silently: a restore is a room
   being put back, not money changing hands. */
export function applySession(snap) {
  if (!snap) return;

  replaceRounds(snap.rounds, snap.dialogue);
  /* The last round held is the current one, so "current" and the history
     below can never disagree. */
  state.dialoguePayload =
    latestPayload(state.dialogueRounds) || snap.dialogue || null;
  state.dialogueLive = false;
  dialogue.reset();

  replaceLog((snap.entries || []).map(normalizeEntry).filter(Boolean));
  replaceTurnLog(
    restoredTurns((snap.turns || []).map(normalizeEntry).filter(Boolean)),
  );
  setNpcs(snap.npcs);
  setInventory(snap.items, snap.inventories);
  setGoals(snap.goals);
  /* Put back as written, and silently: a restore is not somebody being hit. */
  setStatusRolls(snap);
  applyScene(snap.scene);

  showDialogueHistory(state.dialogueRounds);
  state.sessionRestored = true;

  restoreSlots(snap.people);
  restoreProgress(snap.people);
  restoreSelf(snap.people);
  renderRoster();
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();
}

/* Administrateur only: apply it here, then push it to the table. */
export function loadSession(snap) {
  if (!state.isAdmin || !snap) return;
  if (!loadAllowed()) {
    refreshLoadButton();
    noteSession(
      "A save only loads into an untouched room. Leave and rejoin to read one.",
    );
    return;
  }

  applySession(snap);

  if (network.isHost) {
    broadcast({ type: "session", session: snap });
    noteSession("Session restored for the table.");
    return;
  }
  if (sendUpstream({ type: "session-load", session: snap })) {
    noteSession("Session restored for the table.");
    return;
  }
  noteSession("Restored here only — nothing was sent.");
}
