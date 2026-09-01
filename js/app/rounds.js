/* Dialogue rounds from the app's side: a payload arrives, the round is
   remembered under the name it was published with, and each player is handed
   the tree written for them. */

import { DIALOGUE_ROUND_LIMIT } from "../config.js";
import { uid } from "../utils.js";
import * as dialogue from "../dialogue/dialogue.js";
import { cleanRounds } from "../export/rounds.js";
import { state, rosterPayload } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import {
  paintReadyButton,
  renderEntry,
  renderRoster,
  replaceTurnLog,
  systemNote,
} from "./views.js";
import { refreshLoadButton, refreshPlanningLock } from "./locks.js";
import { setSceneOverride } from "./scene.js";

dialogue.setHooks({
  onFinish: () => {
    reportDialogueDone();
    refreshPlanningLock();
  },
  onSkillArt: setSceneOverride,
});

/* Rounds keep their name everywhere they travel, which is what makes this
   safe to call twice for the same round: the host broadcasts a round back to
   the administrateur that sent it. */
export function rememberRound(payload, roundId, at) {
  if (!payload) return null;

  const id =
    typeof roundId === "string" && roundId ? roundId.slice(0, 64) : uid();
  for (let i = 0; i < state.dialogueRounds.length; i += 1) {
    if (state.dialogueRounds[i].id === id) return state.dialogueRounds[i];
  }

  const round = { id, at: Number(at) || Date.now(), payload };
  state.dialogueRounds.push(round);
  while (state.dialogueRounds.length > DIALOGUE_ROUND_LIMIT) {
    state.dialogueRounds.shift();
  }
  /* The room has moved on; a save cannot be dropped over it now. */
  refreshLoadButton();
  return round;
}

/* A history handed over wholesale — from a welcome, or from a save. */
export function replaceRounds(rounds, fallbackPayload) {
  state.dialogueRounds = cleanRounds(rounds, fallbackPayload || null);
}

/* Rounds that are already over, read back as transcript: nothing to press, no
   cues, no vitals spent twice. The administrateur reads nothing back — the
   payloads stay in dialogueRounds. */
export function showDialogueHistory(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) return;
  if (state.isAdmin) return;

  let scenes = 0;
  let mine = 0;

  rounds.forEach((round) => {
    if (!round || !round.payload) return;
    if (dialogue.hasTreeFor(round, network.selfId, state.profile.name)) {
      mine += 1;
    }
    scenes += dialogue.renderRound(round, network.selfId, state.profile.name);
  });

  /* A save records trees by character name; the peer ids in it are long dead.
     A player the save never knew is told so, rather than left staring. */
  if (!mine) {
    systemNote(
      "No scene in this history was written for " +
        (state.profile.name || "you") +
        " — the rounds above are the table's, not yours.",
    );
    return;
  }
  if (!scenes) systemNote("Those rounds hold no readable lines for you.");
}

export function reportDialogueDone() {
  if (state.isAdmin) return;

  if (network.isHost) {
    const me = state.roster.get(network.selfId);
    if (me) me.done = true;
    renderRoster();
    broadcast(rosterPayload());
    return;
  }
  sendUpstream({ type: "dialogue-done" });
}

/* Everyone's side of a new round: keep the payload, run my own tree. */
export function applyDialogue(payload) {
  state.dialoguePayload = payload || null;
  state.dialogueLive = Boolean(state.dialoguePayload);

  if (!state.dialogueLive || state.isAdmin) {
    dialogue.reset();
    refreshPlanningLock();
    return;
  }

  const mine = dialogue.pickTree(
    state.dialoguePayload,
    network.selfId,
    state.profile.name,
  );

  if (!mine) {
    dialogue.reset();
    systemNote("No scene was written for you this round.");
    reportDialogueDone();
    refreshPlanningLock();
    return;
  }

  dialogue.start(mine);
  refreshPlanningLock();
}

/* A new scene does not clear the board: standing plans recede, so the table
   can still read what was planned last round. TURN_LIMIT prunes them.

   The last plan of the round being closed also carries the rule between
   rounds, so two quiet rounds cannot stack two rules on one entry. */
function ageTurnLog() {
  let touched = false;
  let last = null;

  state.turnEntries.forEach((entry) => {
    if (!entry.stale) {
      entry.stale = true;
      last = entry;
      touched = true;
    }
  });

  if (last && !last.roundEnd) {
    last.roundEnd = true;
    touched = true;
  }

  if (touched) replaceTurnLog(state.turnEntries);
}

/* Host only: a payload arrived, so the round restarts — plans age, ready and
   finished flags drop, and everybody gets the trees. */
export function openDialogueRound(payload, roundId, at) {
  const round = rememberRound(payload, roundId, at);

  state.roster.forEach((person) => {
    if (person.admin) return;
    person.done = false;
    person.ready = false;
  });

  if (!state.isAdmin) {
    state.selfReady = false;
    paintReadyButton();
  }

  ageTurnLog();

  broadcast({ type: "turns", turns: state.turnEntries });
  broadcast({
    type: "dialogue",
    payload,
    roundId: round ? round.id : null,
    at: round ? round.at : null,
  });

  applyDialogue(payload);
  renderRoster();
  broadcast(rosterPayload());
}

/* Administrateur only: echo the raw payload locally, then push it out. The
   round is named here and keeps that name through the host and back. */
export function publishDialogue(payload, raw) {
  renderEntry({ text: raw, at: Date.now(), raw: true });

  const roundId = uid();
  const at = Date.now();

  if (network.isHost) {
    openDialogueRound(payload, roundId, at);
    return;
  }

  if (sendUpstream({ type: "dialogue", payload, roundId, at })) {
    rememberRound(payload, roundId, at);
    state.dialoguePayload = payload;
    state.dialogueLive = true;
    refreshPlanningLock();
    return;
  }

  systemNote("Not connected — that payload went nowhere.");
}
