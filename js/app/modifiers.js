/* js/app/modifiers.js */

/* What is working on each character now, and who is told.

   Two halves, deliberately apart. What a character carries moves single skills
   and is read straight off their bag, so picking a thing up changes their
   scores with nothing sent anywhere. What a character consumed moves a whole
   attribute and is the room's business: the administrateur's payload says who
   took what, the host holds it, everybody is told. Nothing here consumes
   anything.

   An item counts once however many are held — stacking is the administrateur's
   arithmetic, written into the payload rather than reckoned here. */

import * as modals from "../modals.js";
import * as dialogue from "../dialogue/dialogue.js";
import { refreshVitals, setVitalsModifiers } from "../vitals.js";
import { findItem, isCurrency, itemKey } from "../inventory/items.js";
import {
  activeSet,
  applyTemporaryOps,
  cleanTemporaryBooks,
  describeActive,
  emptySet,
} from "../modifiers/modifiers.js";
import { state, temporaryFor } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { publishProgress } from "./progress.js";

function holderNames() {
  const out = [];
  state.roster.forEach((person) => {
    if (!person.admin && person.name) out.push(person.name);
  });
  return out;
}

function bagOf(holder) {
  const key = itemKey(holder);
  const holders = Object.keys(state.inventories);
  for (let i = 0; i < holders.length; i += 1) {
    if (itemKey(holders[i]) === key) return state.inventories[holders[i]];
  }
  return null;
}

/* Every modifier the named character's things carry, each tagged with the
   thing that carries it. The purse moves nothing. */
export function heldModifiers(holder) {
  const bag = bagOf(holder) || {};
  const out = [];
  Object.keys(bag).forEach((name) => {
    if (!bag[name] || isCurrency(name)) return;
    const known = findItem(state.items, name);
    const list = known && Array.isArray(known.modifiers) ? known.modifiers : [];
    list.forEach((entry) => {
      out.push({ skill: entry.skill, amount: entry.amount, from: known.name });
    });
  });
  return out;
}

export function activeFor(holder) {
  return activeSet(heldModifiers(holder), temporaryFor(holder));
}

export function selfActive() {
  return state.isAdmin ? emptySet() : activeFor(state.profile.name);
}

/* The one path. Everything that reads a score is told here: the reader that
   weighs passives, the two ceilings, the open sheet, and the table. */
export function refreshModifiers() {
  const active = selfActive();
  state.activeModifiers = active;
  setVitalsModifiers(state.isAdmin ? null : active);
  dialogue.setModifiers(state.isAdmin ? null : active);
  /* A moved endurance or volition moves a ceiling, without healing anybody. */
  refreshVitals(state.sheetState, false);
  modals.refreshModifiers(active);
  publishProgress();
}

export function modifiersPayload() {
  return { type: "modifiers", modifiers: state.temporaryModifiers };
}

export function setTemporaryModifiers(raw) {
  state.temporaryModifiers = cleanTemporaryBooks(raw);
  refreshModifiers();
}

/* Host only: the orders land here and nowhere else, then the table is told. */
export function commitModifierOps(ops) {
  state.temporaryModifiers = applyTemporaryOps(
    state.temporaryModifiers,
    ops,
    holderNames(),
  );
  refreshModifiers();
  broadcast(modifiersPayload());
}

/* Administrateur only: whoever holds the room applies it. */
export function publishModifierOps(ops) {
  if (!ops) return false;
  if (network.isHost) {
    commitModifierOps(ops);
    return true;
  }
  return sendUpstream({ type: "modifier-ops", ops });
}

/* "# Players active modifiers" for the administrateur's clipboard: only the
   seats something is actually working on. */
export function modifierLines() {
  const out = [];
  state.roster.forEach((person) => {
    if (person.admin) return;
    const written = describeActive(activeFor(person.name));
    if (written) out.push(person.name + ": " + written);
  });
  return out;
}
