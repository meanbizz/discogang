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
      if (clean) out[clean.toLowerCase()] = { mode: "concealed", exempt: [] };
    });
    return out;
  }
  if (raw && typeof raw === "object") {
    Object.keys(raw).forEach((name) => {
      const clean = cleanName(name);
      if (!clean) return;
      const val = raw[name];
      let mode = "present";
      let exempt = [];
      if (typeof val === "string") {
        const s = val.trim().toLowerCase();
        if (s === "away" || s === "hindered" || s === "concealed") mode = s;
      } else if (val && typeof val === "object") {
        const s = String(val.mode || "").trim().toLowerCase();
        if (s === "away" || s === "hindered" || s === "concealed") mode = s;
        if (Array.isArray(val.exempt)) {
          exempt = val.exempt
            .map((n) => cleanName(n).toLowerCase())
            .filter(Boolean);
        }
      }
      if (mode !== "present" || exempt.length > 0) {
        out[clean.toLowerCase()] = { mode, exempt };
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
  modals.renderBlurList(playerNames(), state.blurred, setPlayerMode, setPlayerExempt);
}

/* Handles dropdown changes for a player. */
export function setPlayerMode(name, mode) {
  if (!state.isAdmin) return;
  const key = cleanName(name).toLowerCase();
  const next = Object.assign({}, state.blurred);
  const current = next[key]
    ? { mode: next[key].mode || "present", exempt: (next[key].exempt || []).slice() }
    : { mode: "present", exempt: [] };
  const cleanVal = String(mode || "").trim().toLowerCase();
  current.mode =
    cleanVal === "away" || cleanVal === "hindered" || cleanVal === "concealed"
      ? cleanVal
      : "present";
  if (current.mode === "present" && current.exempt.length === 0) {
    delete next[key];
  } else {
    next[key] = current;
  }
  setBlurred(next);

  if (network.isHost) {
    broadcast(blurPayload());
    return;
  }
  sendUpstream({ type: "blur-set", states: state.blurred });
}

/* Handles exempt checkbox changes for a player. */
export function setPlayerExempt(name, otherName, isExempt) {
  if (!state.isAdmin) return;
  const key = cleanName(name).toLowerCase();
  const otherKey = cleanName(otherName).toLowerCase();
  if (!key || !otherKey) return;
  const next = Object.assign({}, state.blurred);
  const current = next[key]
    ? { mode: next[key].mode || "present", exempt: (next[key].exempt || []).slice() }
    : { mode: "present", exempt: [] };
  if (isExempt) {
    if (!current.exempt.includes(otherKey)) current.exempt.push(otherKey);
  } else {
    current.exempt = current.exempt.filter((k) => k !== otherKey);
  }
  if (current.mode === "present" && current.exempt.length === 0) {
    delete next[key];
  } else {
    next[key] = current;
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
  modals.openBlurModal(playerNames(), state.blurred, setPlayerMode, setPlayerExempt);
}
