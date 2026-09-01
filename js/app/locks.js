/* What is available right now: the two composers, and the Load button. */

import { dom } from "../dom.js";
import * as dialogue from "../dialogue/dialogue.js";
import { state, countReady, countScene, everyoneReady } from "./state.js";

export function planningUnlocked() {
  if (!state.dialogueLive) return true;
  const tally = countScene();
  return tally.players > 0 && tally.done === tally.players;
}

export function refreshPlanningLock() {
  const locked = !planningUnlocked();

  if (dom.turnInput) dom.turnInput.disabled = locked;
  if (dom.turnSend) dom.turnSend.disabled = locked;
  if (dom.turnReady) dom.turnReady.disabled = locked;
  if (dom.turnComposer) dom.turnComposer.classList.toggle("is-locked", locked);
  if (!dom.turnLock) return;

  if (!locked) {
    dom.turnLock.hidden = true;
    dom.turnLock.textContent = "";
    return;
  }

  const tally = countScene();
  dom.turnLock.hidden = false;
  dom.turnLock.textContent = !dialogue.isFinished()
    ? "Read your scene to its end before planning."
    : `Waiting on the others — ${tally.done} of ${tally.players} have finished the scene.`;
}

/* The administrateur stays mute until every player has readied up. */
export function refreshSpeakLock() {
  const locked = state.isAdmin && !everyoneReady();

  if (dom.textInput) dom.textInput.disabled = locked;
  if (dom.sendButton) dom.sendButton.disabled = locked;
  if (dom.composer) dom.composer.classList.toggle("is-locked", locked);
  if (!dom.composerLock) return;

  if (!locked) {
    dom.composerLock.hidden = true;
    dom.composerLock.textContent = "";
    return;
  }

  const tally = countReady();
  dom.composerLock.hidden = false;
  dom.composerLock.textContent = tally.players
    ? `Waiting on the players — ${tally.readied} of ${tally.players} ready.`
    : "Waiting for players to join.";
}

/* Load is a first move, not a command: a save replaces the room wholesale and
   holds no record of who had read what, so it only ever lands in a room that
   has not started. Leaving and rejoining is what reopens it. */
export function loadAllowed() {
  return (
    state.isAdmin && !state.sessionRestored && !state.dialogueRounds.length
  );
}

export function refreshLoadButton() {
  if (!dom.sessionLoad) return;

  const allowed = loadAllowed();
  dom.sessionLoad.disabled = !allowed;
  dom.sessionLoad.dataset.locked = allowed ? "false" : "true";
  dom.sessionLoad.setAttribute("aria-disabled", allowed ? "false" : "true");
  dom.sessionLoad.title = allowed
    ? "Restore a session from a .json save"
    : state.sessionRestored
      ? "A save has already been read this session."
      : "The room has started — a save only loads into an untouched room.";
}
