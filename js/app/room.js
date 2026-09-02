/* js/app/room.js */

/* Joining and leaving: which half of the interface is present, and what is
   torn down on the way out.

   Experience is the session's, not the browser's: a seat that leaves the room
   drops its ledger with everything else, and only a save can hand it back.
   Money goes the same way — it lives in the room's inventories, and a fresh
   seat starts with an empty purse. */

import { dom, anchors, setPresent } from "../dom.js";
import { isAdminName } from "../utils.js";
import * as audio from "../audio/index.js";
import * as music from "../audio/music.js";
import * as dialogue from "../dialogue/dialogue.js";
import * as modals from "../modals.js";
import * as overlays from "../overlays.js";
import * as vitals from "../vitals.js";
import { resetXp } from "../xp.js";
import { state } from "./state.js";
import { network } from "./net.js";
import {
  paintReadyButton,
  renderRoster,
  renderTurnEmptyState,
  replaceLog,
  replaceTurnLog,
  setStatus,
} from "./views.js";
import {
  refreshLoadButton,
  refreshPlanningLock,
  refreshSpeakLock,
} from "./locks.js";
import { applyScene } from "./scene.js";
import { setInventory } from "./inventory.js";
import { setGoals } from "./goals.js";
import { refreshLedger } from "./progress.js";

function seat(isAdmin) {
  dom.roleLabel.hidden = !isAdmin;
  setPresent(anchors.deck, dom.deck, isAdmin);
  setPresent(anchors.adminTools, dom.adminTools, isAdmin);
  setPresent(anchors.composer, dom.composer, isAdmin);
  setPresent(anchors.stageSide, dom.stageSide, !isAdmin);
  setPresent(anchors.turnComposer, dom.turnComposer, !isAdmin);
  setPresent(anchors.panelFoot, dom.panelFoot, !isAdmin);
  setPresent(anchors.readyBanner, dom.readyBanner, isAdmin);
}

function clearSeat() {
  dom.roleLabel.hidden = true;
  setPresent(anchors.deck, dom.deck, false);
  setPresent(anchors.adminTools, dom.adminTools, false);
  setPresent(anchors.composer, dom.composer, false);
  setPresent(anchors.stageSide, dom.stageSide, false);
  setPresent(anchors.turnComposer, dom.turnComposer, false);
  setPresent(anchors.panelFoot, dom.panelFoot, false);
  setPresent(anchors.readyBanner, dom.readyBanner, false);
}

export function connect(room, name, portrait) {
  network.sessionGeneration += 1;
  network.joinAttempts = 0;

  state.roomId = room;
  state.profile = { name, portrait };
  state.isAdmin = isAdminName(name);
  seat(state.isAdmin);

  dom.joinPanel.hidden = true;
  dom.sessionPanel.hidden = false;

  setStatus("connecting", "Finding the room…");
  state.roster.clear();
  state.seats.clear();
  state.savedProgress.clear();
  state.npcs = [];
  /* Empty, which the item sieve reads as "the money and nothing else": every
     character has a purse from the first frame, holding nothing. */
  setInventory([], {});
  /* No goals until a payload or a save hands this seat some. */
  setGoals({});
  renderRoster();
  replaceLog([]);
  replaceTurnLog([]);
  state.selfReady = false;
  paintReadyButton();
  dom.turnError.textContent = "";

  state.dialoguePayload = null;
  state.dialogueRounds = [];
  state.dialogueLive = false;
  /* A fresh join: the welcome that follows is this seat's first. */
  state.welcomed = false;
  state.sessionRestored = false;
  dialogue.reset();
  /* Nothing another room was announcing belongs to this one. */
  overlays.reset();
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();

  applyScene({ image: null });
  state.sheetState = state.isAdmin
    ? null
    : window.DiscoSkillSheet?.normalize(state.stagedSheet);
  /* Passive checks are weighed against this sheet, so the reader is told
     before any round can arrive. */
  dialogue.setSheet(state.sheetState);
  if (modals.getSheetInstance()) {
    modals.getSheetInstance().setState(state.sheetState, true);
  }
  /* A new seat has earned nothing yet. Whatever the last session left in the
     ledger is not this character's. */
  resetXp();
  refreshLedger();
  vitals.refreshVitals(state.sheetState, true);
  music.describeTrack();
  music.refreshAudioUnlockButton(state.isAdmin);

  if (location.hash.slice(1) !== state.roomId) location.hash = state.roomId;

  network.openRoom(state.roomId, state.profile, network.sessionGeneration);
  if (state.isAdmin) dom.textInput.focus();
  else dom.turnInput.focus();
}

export function leave() {
  network.disconnect();
  audio.silence();

  modals.closePortrait();
  modals.closePsyche();
  modals.closeNpcModal();
  modals.closeInventory();
  modals.closeItemsModal();
  modals.closeGoals();

  dialogue.reset();
  overlays.reset();
  state.dialoguePayload = null;
  state.dialogueRounds = [];
  state.dialogueLive = false;
  state.welcomed = false;
  state.sessionRestored = false;

  state.sheetState = null;
  state.stagedSheet = null;
  dialogue.setSheet(null);
  if (modals.getSheetInstance()) modals.getSheetInstance().setState(null, true);

  resetXp();
  refreshLedger();

  state.roster.clear();
  state.seats.clear();
  state.savedProgress.clear();
  state.npcs = [];
  state.logEntries = [];
  state.turnEntries = [];
  state.isAdmin = false;
  state.selfId = null;
  setInventory([], {});
  setGoals({});

  dom.sessionPanel.hidden = true;
  dom.joinPanel.hidden = false;
  dom.log.textContent = "";
  dom.textInput.value = "";
  dom.turnLog.textContent = "";
  dom.turnInput.value = "";
  dom.turnError.textContent = "";

  state.selfReady = false;
  paintReadyButton();

  if (dom.deckError) dom.deckError.textContent = "";
  if (dom.sessionNote) dom.sessionNote.textContent = "";
  if (dom.sessionFile) dom.sessionFile.value = "";
  if (dom.audioUnlock) dom.audioUnlock.hidden = true;
  if (dom.trackLabel) dom.trackLabel.textContent = "Silence.";

  clearSeat();

  dom.statsInput.value = "";
  vitals.refreshVitals(null, true);
  renderTurnEmptyState();
  applyScene({ image: null });
  setStatus("offline", "Offline");
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();
  dom.nameInput.focus();
}
