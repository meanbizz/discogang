/* js/app/goals.js */

/* The table's goals from the app's side: what a payload's orders do to them,
   who is told, and what this seat reads in its own dashboard.

   A goal belongs to the character it names, so there is no catalogue and no
   administrateur's modal. The host holds every book, orders move them here and
   nowhere else, and each player only ever reads their own. */

import * as modals from "../modals.js";
import * as overlays from "../overlays.js";
import {
  applyGoalOps,
  cleanGoalBooks,
  goalKey,
  goalsFor,
} from "../goals/goals.js";
import { grantGoalXp } from "../xp.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { systemNote } from "./views.js";
import { publishProgress, refreshLedger } from "./progress.js";

export function goalsPayload() {
  return { type: "goals", goals: state.goals };
}

/* This seat's own book, in the order it was written. */
export function selfGoals() {
  return goalsFor(state.goals, state.profile.name);
}

/* Every player at the table, for an order addressed to "*". */
function everyone() {
  const names = [];
  state.roster.forEach((person) => {
    if (person.admin || !person.name) return;
    if (names.indexOf(person.name) === -1) names.push(person.name);
  });
  return names;
}

/* Repainted only while the dashboard is open, so a book that moved underneath
   the player is never read stale. */
export function refreshGoals() {
  modals.refreshGoals(selfGoals());
}

/* What this seat has already been paid for, so a completion cannot earn twice
   — a wire that comes back finds its own record intact. */
const paid = Object.create(null);

function held(key) {
  return Object.prototype.hasOwnProperty.call(paid, key);
}

/* A book adopted as it stands: whatever is done was settled before this seat
   could see it happen. */
function forget(list) {
  Object.keys(paid).forEach((key) => {
    delete paid[key];
  });
  list.forEach((goal) => {
    if (goal.done) paid[goalKey(goal.name)] = true;
  });
}

/* Whatever is done and unpaid, earned now. The administrateur carries no book,
   so none of it is theirs to collect. */
function collect(list) {
  if (state.isAdmin) return;
  const earned = [];

  list.forEach((goal) => {
    const key = goalKey(goal.name);
    if (!goal.done || held(key)) return;
    paid[key] = true;
    earned.push({ goal, landed: grantGoalXp(goal.xp) });
  });

  if (!earned.length) return;
  /* Counted before it is announced: a plate that fails must not cost the
     skill point it was announcing. */
  refreshLedger();
  publishProgress();

  earned.forEach(({ goal, landed }) => {
    systemNote(
      landed.gained
        ? "Goal completed: " + goal.name + ". +" + landed.gained + " XP."
        : "Goal completed: " + goal.name + ".",
    );
    /* A plate of its own, so two goals finishing together are read one after
       the other rather than over each other. */
    overlays.goal(goal.name, landed.gained, landed.granted);
  });
}

/* news is whether a completion in these books is owed: false for a room read
   as it stands, true for one the table has just changed. */
export function setGoals(books, news) {
  state.goals = cleanGoalBooks(books);
  const mine = selfGoals();
  if (news) collect(mine);
  else forget(mine);
  refreshGoals();
}

/* Host only: the books move here, then the table is told. */
export function commitGoalOps(ops) {
  /* Through setGoals, so a host who is also a player collects their own. */
  setGoals(applyGoalOps(state.goals, ops, everyone()), true);
  broadcast(goalsPayload());
}

/* Administrateur: applied here when this seat is the host, asked of the host
   otherwise. */
export function publishGoalOps(ops) {
  if (!state.isAdmin || !ops) return;
  if (network.isHost) {
    commitGoalOps(ops);
    return;
  }
  sendUpstream({ type: "goal-ops", ops });
}

export function openGoals() {
  modals.openGoals(selfGoals());
}

/* For the administrateur's import: the only window they have on what the table
   is chasing, since no modal of theirs lists it. */
export function goalLines() {
  const lines = [];
  Object.keys(state.goals).forEach((holder) => {
    (state.goals[holder] || []).forEach((goal) => {
      const paid = goal.xp ? " (+" + goal.xp + " XP)" : "";
      const mark = goal.done ? " — completed" : "";
      lines.push(holder + " — " + goal.name + paid + mark);
    });
  });
  return lines;
}
