/* js/app/status.js */

/* Down and K.I.A. from the app's side: who is on the floor, who is past
   picking up, and what either costs the seat it names.

   The two rolls are the room's, held by the host and read by everybody, so a
   plate over a portrait means the same thing at every seat. An
   administrateur's payload moves them; the one thing a player reports for
   themselves is their own bars running out, which the host writes down and
   then tells the table. */

import { dom } from "../dom.js";
import * as vitals from "../vitals.js";
import { applyStatusOrders, cleanStatus, holds } from "../status/status.js";
import { state, isSelfDown } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { paintReadyButton, renderRoster, systemNote } from "./views.js";

export function statusPayload() {
  return { type: "status", down: state.down, kia: state.kia };
}

/* A seat on the floor reads none of the table's plans and writes none of its
   own: the plan log blurs and stops answering the mouse. */
export function paintDowned() {
  if (dom.turnLog) dom.turnLog.classList.toggle("is-downed", isSelfDown());
}

function added(before, after) {
  return after.filter((name) => !holds(before, name));
}

/* Only the table changing is said out loud; a room read as it stands says
   nothing, because none of it happened here. */
function announce(before, after) {
  added(before.kia, after.kia).forEach((name) => {
    systemNote(name + " is dead.");
  });
  added(before.down, after.down).forEach((name) => {
    systemNote(name + " is down.");
  });
  before.down.concat(before.kia).forEach((name) => {
    if (holds(after.down, name) || holds(after.kia, name)) return;
    systemNote(name + " is back on their feet.");
  });
}

/* The room's two rolls, adopted. news is whether this is the table changing
   rather than a welcome or a save being read back. */
export function setStatusRolls(rolls, news) {
  const before = { down: state.down, kia: state.kia };
  const wasDown = isSelfDown();
  const after = cleanStatus(rolls);

  state.down = after.down;
  state.kia = after.kia;

  /* Picked back up with a single step in whichever bar emptied, so a revived
     character is not one node from the floor again. */
  if (wasDown && !isSelfDown()) vitals.reviveVitals();

  if (news) announce(before, after);
  /* The roster carries the plates, and repaints both locks on its way. */
  renderRoster();
  paintReadyButton();
  paintDowned();
}

/* Host only: the rolls move here, then the table is told. */
export function commitStatusOps(ops) {
  const held = { down: state.down, kia: state.kia };
  setStatusRolls(applyStatusOrders(held, ops), true);
  broadcast(statusPayload());
}

/* Administrateur: applied here when this seat is the host, asked of the host
   otherwise. */
export function publishStatusOps(ops) {
  if (!state.isAdmin || !ops) return;
  if (network.isHost) {
    commitStatusOps(ops);
    return;
  }
  sendUpstream({ type: "status-ops", ops });
}

/* Host only: one more name on the down roll, whoever reported it. */
export function commitDown(name) {
  commitStatusOps({ down: state.down.concat([name]), kia: null });
}

/* This seat's own bars ran out. The plate and the lock are not worth a round
   trip, so they land here at once and the host is told after. */
export function reportSelfDown() {
  if (state.isAdmin || isSelfDown()) return;
  const name = state.profile.name;
  if (!name) return;

  if (network.isHost) {
    commitDown(name);
    return;
  }
  setStatusRolls({ down: state.down.concat([name]), kia: state.kia }, true);
  sendUpstream({ type: "down" });
}

/* The reader spends the bars: an emptied one puts this seat down, and a seat
   on the floor is topped up by nothing the reader does. */
vitals.setVitalsHooks({ onEmpty: reportSelfDown, floored: isSelfDown });
