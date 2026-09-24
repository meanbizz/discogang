/* What is available right now: the two composers. */

import { dom } from "../dom.js";
import * as dialogue from "../dialogue/dialogue.js";
/* Loaded here so the countdown is wired wherever the room is. */
import "./timer.js";
import {
  state,
  countReady,
  countScene,
  everyoneReady,
  isSelfDown,
  isSelfKia,
} from "./state.js";

export function planningUnlocked() {
  /* On the floor: nothing is planned from this seat until it is picked up. */
  if (isSelfDown()) return false;
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
  /* On the floor: the plans are still written there, but no longer for this seat to read. */
  if (dom.turnLog) dom.turnLog.classList.toggle("is-downed", isSelfDown());
  if (!dom.turnLock) return;

  if (!locked) {
    dom.turnLock.hidden = true;
    dom.turnLock.textContent = "";
    return;
  }

  if (isSelfDown()) {
    dom.turnLock.hidden = false;
    dom.turnLock.textContent = isSelfKia()
      ? "You have died and have found peace."
      : "You have fallen unconscious. You are unable to plan anything.";
    return;
  }

  const tally = countScene();
  dom.turnLock.hidden = false;
  dom.turnLock.textContent = !dialogue.isFinished()
    ? "Read your scene to its end before planning."
    : `Waiting on the others — ${tally.done} of ${tally.players} have finished the scene.`;
}

/* Import is always the administrateur's to press; the colour is the only thing
   the table's readiness decides. */
export function paintImportButton() {
  const button = document.getElementById("import-button");
  if (!button) return;
  button.hidden = !state.isAdmin;
  button.disabled = false;
  button.dataset.ready = everyoneReady() ? "true" : "false";
}

/* The administrateur stays mute until every player has readied up. */
export function refreshSpeakLock() {
  paintImportButton();
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
