/* What the two seats can actually do: ready up, speak, plan, and lift the
   plans to the clipboard. */

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
import { publishDialogue } from "./rounds.js";

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

/* Only what was planned for the round in progress: anything stale belongs to
   a scene already played out and was imported once already. */
export function exportTurns() {
  if (!state.isAdmin) return;

  const fresh = state.turnEntries.filter((entry) => !entry.stale);
  if (importResetTimer) clearTimeout(importResetTimer);

  if (!fresh.length) {
    dom.importButton.textContent = "Nothing new";
    importResetTimer = setTimeout(() => {
      dom.importButton.textContent = "Import";
    }, 1600);
    return;
  }

  const lines = fresh.map((entry) => `${entry.author} — ${entry.text}`);
  copyText(`# Actions planned by players:\n${lines.join("\n")}`, (ok) => {
    if (importResetTimer) clearTimeout(importResetTimer);
    dom.importButton.textContent = ok ? "Copied ✓" : "Copy failed";
    importResetTimer = setTimeout(() => {
      dom.importButton.textContent = "Import";
    }, 1600);
  });
}
