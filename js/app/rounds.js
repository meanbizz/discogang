/* js/app/rounds.js */

/* Dialogue rounds from the app's side: a payload arrives, the round is
   remembered under the name it was published with, each player is handed the
   tree written for them, and what they choose is kept on the round it was
   chosen in.

   Choices live on the round rather than beside it, so they travel wherever it
   already does: the welcome payload, the session broadcast, and the save. */

import { DIALOGUE_ROUND_LIMIT } from "../config.js";
import { cleanName, uid } from "../utils.js";
import * as dialogue from "../dialogue/dialogue.js";
import { cleanRounds } from "../export/rounds.js";
import { state, isSelfDown, rosterPayload } from "./state.js";
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
import { publishProgress, refreshLedger } from "./progress.js";

dialogue.setHooks({
  onFinish: () => {
    reportDialogueDone();
    refreshPlanningLock();
  },
  onSkillArt: setSceneOverride,
  onChoice: reportChoice,
  /* The reader has already moved the ledger and put the overlay on screen.
     What is left is telling the table, and the sheet's header if it happens to
     be open behind the scene. */
  onXp: () => {
    refreshLedger();
    publishProgress();
  },
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

  const round = { id, at: Number(at) || Date.now(), payload, choices: {} };
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

/* The round being read right now is always the newest one held: rememberRound
   appends it, and a welcome puts the live one last. Null when no round has
   arrived. */
export function currentRound() {
  const rounds = state.dialogueRounds;
  return rounds.length ? rounds[rounds.length - 1] : null;
}

function roundById(roundId) {
  if (!roundId) return currentRound();
  const rounds = state.dialogueRounds;
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    if (rounds[i].id === roundId) return rounds[i];
  }
  return null;
}

function listFor(round, author) {
  if (!round.choices) round.choices = {};
  if (!Object.prototype.hasOwnProperty.call(round.choices, author)) {
    round.choices[author] = [];
  }
  return round.choices[author];
}

/* The administrateur is the one who needs to know what was picked, so it is
   written into their log as it happens. Rendered rather than committed: the
   echo is theirs to read, not the table's to inherit through a restore. */
function echoChoice(author, choice) {
  if (!state.isAdmin) return;
  renderEntry({
    system: true,
    text: author + " chose — " + dialogue.describeChoice(choice),
    at: Date.now(),
  });
}

/* Somebody's choice, from the wire or from this seat's own reader. Returns
   what was kept, so a host knows what to relay. */
export function acceptChoice(author, roundId, raw) {
  const name = cleanName(author);
  const choice = dialogue.cleanChoice(raw);
  const round = roundById(roundId);
  if (!name || !choice || !round) return null;

  dialogue.keepChoice(listFor(round, name), choice);
  echoChoice(name, choice);
  return { round, author: name, choice };
}

/* This seat's own reader picked something. The administrateur reads no trees,
   so it never fires for them. */
export function reportChoice(raw) {
  if (state.isAdmin) return;

  const round = currentRound();
  if (!round) return;
  const choice = dialogue.cleanChoice(
    Object.assign({ at: Date.now() }, raw || {}),
  );
  if (!choice) return;

  const author = cleanName(state.profile.name) || "Unnamed";
  dialogue.keepChoice(listFor(round, author), choice);

  if (network.isHost) {
    broadcast({ type: "choice", roundId: round.id, author, choice });
    return;
  }
  sendUpstream({ type: "choice", roundId: round.id, choice });
}

/* Rounds that are already over, read back as transcript: nothing to press, no
   cues, no vitals spent twice, no experience earned twice, and each fork
   settled the way the player settled it. The administrateur reads nothing
   back — the payloads stay in dialogueRounds. */
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

  /* A seat on the floor reads nothing: no node spends what it has left, and
     the round is not held waiting on it. */
  if (isSelfDown()) {
    dialogue.reset();
    reportDialogueDone();
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
   finished flags drop, and everybody gets the trees. Choices stay on the
   rounds they were made in. */
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
