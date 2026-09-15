/* js/app/blur.js */

/* The administrateur's blur roll: whose plans read as smears. Like the down
   roll, the list is the room's — the administrateur moves it, the host holds
   and broadcasts it, and each seat spares only its own author's lines. */

import { cleanName } from "../utils.js";
import * as modals from "../modals.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { replaceTurnLog } from "./views.js";

export function cleanBlurStates(raw) {
  /* Plain literal: BinaryPack throws on null-prototype objects, which kills
     the blur payload on the wire. */
  const out = {};
  if (Array.isArray(raw)) {
    raw.forEach((name) => {
      const clean = cleanName(name);
      if (clean) out[clean.toLowerCase()] = "concealed";
    });
    return out;
  }
  if (raw && typeof raw === "object") {
    Object.keys(raw).forEach((name) => {
      const clean = cleanName(name);
      if (!clean) return;
      const val = String(raw[name] || "").trim().toLowerCase();
      if (val === "away" || val === "hindered" || val === "concealed") {
        out[clean.toLowerCase()] = val;
      }
    });
  }
  return out;
}

export function blurPayload() {
  return { type: "blur", states: state.blurred };
}

function playerNames() {
  const out = [];
  state.roster.forEach((person) => {
    if (!person.admin && person.name) out.push(person.name);
  });
  return out;
}

/* Adopts the blur states map and re-renders the plan log and modal list. */
export function setBlurred(raw) {
  state.blurred = cleanBlurStates(raw);
  replaceTurnLog(state.turnEntries);
  modals.renderBlurList(playerNames(), state.blurred, setPlayerMode);
}

/* Handles dropdown changes for a player. */
export function setPlayerMode(name, mode) {
  if (!state.isAdmin) return;
  const key = cleanName(name).toLowerCase();
  const next = Object.assign({}, state.blurred);
  const cleanVal = String(mode || "").trim().toLowerCase();
  if (cleanVal === "away" || cleanVal === "hindered" || cleanVal === "concealed") {
    next[key] = cleanVal;
  } else {
    delete next[key];
  }
  setBlurred(next);

  if (network.isHost) {
    broadcast(blurPayload());
    return;
  }
  sendUpstream({ type: "blur-set", states: state.blurred });
}

/* The administrateur's desk is the only place the modal opens from. */
export function openBlur() {
  if (!state.isAdmin) return;
  modals.openBlurModal(playerNames(), state.blurred, setPlayerMode);
}
