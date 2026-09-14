/* js/app/blur.js */

/* The administrateur's blur roll: whose plans read as smears. Like the down
   roll, the list is the room's — the administrateur moves it, the host holds
   and broadcasts it, and each seat spares only its own author's lines. */

import { cleanName } from "../utils.js";
import * as modals from "../modals.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { replaceTurnLog } from "./views.js";

export function blurPayload() {
  return { type: "blur", names: state.blurred };
}

function playerNames() {
  const out = [];
  state.roster.forEach((person) => {
    if (!person.admin && person.name) out.push(person.name);
  });
  return out;
}

/* The roll adopted as it stands: the plan log repaints, since the blur is a
   class each entry earns at render time. */
export function setBlurred(raw) {
  const seen = Object.create(null);
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((name) => {
    const clean = cleanName(name);
    const key = clean.toLowerCase();
    if (!clean || seen[key]) return;
    seen[key] = true;
    out.push(clean);
  });
  state.blurred = out;
  replaceTurnLog(state.turnEntries);
  modals.renderBlurList(playerNames(), state.blurred, togglePlayer);
}

/* The administrateur's own hand on a checkbox. */
function togglePlayer(name, on) {
  if (!state.isAdmin) return;
  const key = cleanName(name).toLowerCase();
  const held = state.blurred.filter(
    (heldName) => cleanName(heldName).toLowerCase() !== key,
  );
  if (on) held.push(cleanName(name));
  setBlurred(held);

  if (network.isHost) {
    broadcast(blurPayload());
    return;
  }
  sendUpstream({ type: "blur-set", names: state.blurred });
}

/* The administrateur's desk is the only place the modal opens from. */
export function openBlur() {
  if (!state.isAdmin) return;
  modals.openBlurModal(playerNames(), state.blurred, togglePlayer);
}
