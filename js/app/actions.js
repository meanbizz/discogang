/* js/app/actions.js */

/* What the two seats can actually do: ready up, speak, plan, and lift the
   plans and the choices to the clipboard. */

import { TURN_MIN_LENGTH } from "../config.js";
import { dom } from "../dom.js";
import { cleanText, copyText, uid } from "../utils.js";
import * as dialogue from "../dialogue/dialogue.js";
import { state, everyoneReady, rosterPayload } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import {
  commit,
  commitTurn,
  paintReadyButton,
  renderRoster,
  systemNote,
} from "./views.js";
import { planningUnlocked } from "./locks.js";
import { currentRound, publishDialogue } from "./rounds.js";

export function setSelfReady(next) {
  if (state.isAdmin) return;
  if (!planningUnlocked()) return;

  state.selfReady = Boolean(next);
  paintReadyButton();

  if (network.isHost) {
    const me = state.roster.get(network.selfId);
    if (me) me.ready = state.selfReady;
    renderRoster();
    broadcast(rosterPayload());
    return;
  }
  sendUpstream({ type: "ready", ready: state.selfReady });
}

/* A payload takes precedence over prose: whatever parses as a turn is
   published as one. */
export function shareText(text) {
  if (!state.isAdmin) return;
  if (!everyoneReady()) {
    systemNote("Not everybody is ready. Nothing leaves this desk yet.");
    return;
  }

  const attempt = dialogue.parsePayload(text);
  if (attempt.payload) {
    publishDialogue(attempt.payload, attempt.raw);
    return;
  }
  if (attempt.error) {
    systemNote(attempt.error);
    return;
  }

  const body = cleanText(text);
  if (!body) return;

  if (network.isHost) {
    const entry = {
      id: uid(),
      author: state.profile.name,
      text: body,
      at: Date.now(),
    };
    commit(entry);
    broadcast({ type: "entry", entry });
    return;
  }
  if (sendUpstream({ type: "entry", entry: { text: body } })) return;
  systemNote("Not connected — that line went nowhere.");
}

export function shareTurn(text) {
  if (state.isAdmin) return false;
  if (!planningUnlocked()) {
    dom.turnError.textContent = "The scene is still playing out.";
    return false;
  }

  const body = cleanText(text);
  if (body.length < TURN_MIN_LENGTH) {
    dom.turnError.textContent = `A plan needs at least ${TURN_MIN_LENGTH} characters.`;
    return false;
  }
  dom.turnError.textContent = "";

  if (network.isHost) {
    const entry = {
      id: uid(),
      authorId: network.selfId,
      author: state.profile.name,
      text: body,
      at: Date.now(),
    };
    commitTurn(entry);
    broadcast({ type: "turn", turn: entry });
    return true;
  }
  return sendUpstream({ type: "turn", turn: { text: body } });
}

let importResetTimer = null;

/* What each player picked in the round now closing, in the order they picked
   it. The administrateur writes the next round against this, so it goes to
   the clipboard beside the plans. */
function choiceLines() {
  const round = currentRound();
  if (!round || !round.choices) return [];

  const out = [];
  Object.keys(round.choices).forEach((author) => {
    const list = round.choices[author];
    if (!Array.isArray(list)) return;
    list.forEach((choice) => {
      out.push(author + " — " + dialogue.describeChoice(choice));
    });
  });
  return out;
}

function flashImport(face) {
  if (importResetTimer) clearTimeout(importResetTimer);
  dom.importButton.textContent = face;
  importResetTimer = setTimeout(() => {
    dom.importButton.textContent = "Import";
  }, 1600);
}

/* Only what was planned for the round in progress: anything stale belongs to
   a scene already played out and was imported once already. The choices come
   from that same round, so the two halves always describe one turn. */
export function exportTurns() {
  if (!state.isAdmin) return;

  const fresh = state.turnEntries.filter((entry) => !entry.stale);
  const chosen = choiceLines();

  if (!fresh.length && !chosen.length) {
    flashImport("Nothing new");
    return;
  }

  const parts = [];
  if (fresh.length) {
    parts.push(
      "# Actions planned by players:\n" +
        fresh.map((entry) => `${entry.author} — ${entry.text}`).join("\n"),
    );
  }
  if (chosen.length) {
    parts.push(
      "# Options the players chose this round:\n" + chosen.join("\n"),
    );
  }

  copyText(parts.join("\n\n"), (ok) => {
    flashImport(ok ? "Copied ✓" : "Copy failed");
  });
}
