/* js/app/actions.js */

/* What the two seats can actually do: ready up, speak, plan, lift the plans,
   the items and the table's skills to the clipboard, and — for a player — take
   their own character away in a file. */

import { TURN_MIN_LENGTH } from "../config.js";
import { dom } from "../dom.js";
import { cleanText, copyText, uid } from "../utils.js";
import * as dialogue from "../dialogue/dialogue.js";
import * as sfx from "../audio/sfx.js";
import { vitals } from "../vitals.js";
import * as character from "../export/character.js";
import { download } from "../export/file.js";
import { state, everyoneReady, rosterPayload } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import {
  commit,
  commitTurn,
  paintReadyButton,
  renderEntry,
  renderRoster,
  systemNote,
} from "./views.js";
import { planningUnlocked } from "./locks.js";
import { publishDialogue } from "./rounds.js";
import { publishOps, selfItems, usedItemLines } from "./inventory.js";
import { goalLines, publishGoalOps, selfGoals } from "./goals.js";
import { skillLines } from "./progress.js";

export function setSelfReady(next) {
  if (state.isAdmin) return;
  if (!planningUnlocked()) return;

  state.selfReady = Boolean(next);
  /* The player's own press on the switch, either way it went. */
  sfx.playReady();
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
   published as one. Items and goals move before the trees that mention them. */
export function shareText(text) {
  if (!state.isAdmin) return;
  if (!everyoneReady()) {
    systemNote("Not everybody is ready. Nothing leaves this desk yet.");
    return;
  }

  const attempt = dialogue.parsePayload(text);
  if (attempt.payload || attempt.inventory || attempt.goals) {
    if (attempt.inventory) publishOps(attempt.inventory);
    if (attempt.goals) publishGoalOps(attempt.goals);
    if (attempt.payload) publishDialogue(attempt.payload, attempt.raw);
    else renderEntry({ text: attempt.raw, at: Date.now(), raw: true });
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
    dom.turnError.textContent = `A plan needs to be at least ${TURN_MIN_LENGTH} letters long.`;
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

function flashImport(face) {
  if (importResetTimer) clearTimeout(importResetTimer);
  dom.importButton.textContent = face;
  importResetTimer = setTimeout(() => {
    dom.importButton.textContent = "Import";
  }, 1600);
}

/* Only what was planned for the round in progress: anything stale belongs to
   a scene already played out and was imported once already.

   What each player picked inside their own tree is deliberately absent. The
   administrateur writes the next round against what the table means to do and
   what it is capable of, and the forks are already recorded on the round
   itself — repeating them here only buried the plans. */
export function exportTurns() {
  if (!state.isAdmin) return;

  const fresh = state.turnEntries.filter((entry) => !entry.stale);
  const used = usedItemLines(fresh.map((entry) => entry.text));
  const skills = skillLines();
  const goals = goalLines();

  if (!fresh.length) {
    flashImport("Nothing new");
    return;
  }

  const parts = [];
  if (used.length) {
    parts.push("# Players use the following items:\n" + used.join("\n"));
  }
  parts.push(
    "# Actions planned by players:\n" +
      fresh.map((entry) => `${entry.author} — ${entry.text}`).join("\n"),
  );
  if (skills.length) {
    parts.push("# Players skills\n" + skills.join("\n"));
  }
  /* The administrateur has no modal for goals, so this is their only reading
     of what the table is chasing. */
  if (goals.length) {
    parts.push("# Players goals\n" + goals.join("\n"));
  }

  copyText(parts.join("\n\n"), (ok) => {
    flashImport(ok ? "Copied ✓" : "Copy failed");
  });
}

/* A player's own character, written to a file they keep: the attributes and
   skills their sheet holds, what they are carrying, what they are after, and
   where their two bars stand. Local from start to finish — nothing about this
   leaves the seat, and the file is written in the shape the join form reads
   back. */
export function exportCharacter() {
  if (state.isAdmin) return;

  const snap = character.snapshot({
    name: state.profile.name,
    sheetState: state.sheetState,
    items: selfItems(),
    goals: selfGoals(),
    vitals,
  });

  systemNote(
    download(snap, character.fileName(snap))
      ? "Your character was written to a file."
      : "That character file could not be written.",
  );
}
