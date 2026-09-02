/* js/app/progress.js */

/* This seat's experience and skills: earned here, read by the table, and
   handed back after a restore.

   The ledger and the sheet are the player's own — no other seat's copy decides
   anything. What travels is a reading of them, so the administrateur can see
   what the table is capable of and a save has something to give back. The
   administrateur keeps no sheet, so nothing here speaks for them. */

import * as modals from "../modals.js";
import { ledger, setXp, spendPoint, xpPayload } from "../xp.js";
import {
  adoptAllocated,
  allocatedPoints,
  cleanAllocated,
  describeSkills,
  skillScores,
} from "../sheet.js";
import * as dialogue from "../dialogue/dialogue.js";
import { refreshVitals } from "../vitals.js";
import { state, rosterPayload } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";

/* skills is what a check is written against; allocated is only the points the
   player spent, which is the half a save has to give back. */
export function progressPayload() {
  return {
    type: "progress",
    xp: xpPayload(),
    skills: skillScores(state.sheetState),
    allocated: allocatedPoints(state.sheetState),
  };
}

export function publishProgress() {
  if (state.isAdmin) return;
  const reading = progressPayload();

  if (network.isHost) {
    const me = state.roster.get(network.selfId);
    if (me) {
      me.skills = reading.skills;
      me.allocated = reading.allocated;
      me.xp = reading.xp;
    }
    broadcast(rosterPayload());
    return;
  }
  sendUpstream(reading);
}

/* The open sheet's header, told what it may spend. */
export function refreshLedger() {
  modals.refreshPsycheLedger(ledger());
}

/* The sheet asks before it moves a pip; this is the answer. Returning false
   leaves the sheet exactly as it was. */
export function spendSkillPoint() {
  if (state.isAdmin) return false;
  if (!spendPoint()) return false;
  /* The count the header prints has just changed, and the sheet is about to
     re-render with it. */
  refreshLedger();
  return true;
}

/* The sheet changed under the player's hands — a spent point, or a sheet
   reloaded. Everything downstream of a score is told in one place. */
export function adoptSheet(next) {
  state.sheetState = next || null;
  dialogue.setSheet(state.sheetState);
  publishProgress();
}

/* A save's record of this seat, put back: the ledger as it stood, and the
   points that had been spent written over the sheet the player arrived with.
   The sheet's own normalize is what caps them. */
export function adoptProgress(raw) {
  if (!raw || typeof raw !== "object") return;
  setXp(raw.xp);

  const wanted = cleanAllocated(raw.allocated);
  if (Object.keys(wanted).length && window.DiscoSkillSheet) {
    const merged = window.DiscoSkillSheet.normalize(
      adoptAllocated(state.sheetState, wanted),
    );
    state.sheetState = merged;
    dialogue.setSheet(merged);
    const sheet = modals.getSheetInstance();
    if (sheet) sheet.setState(merged, true);
    /* A restored point in endurance or volition raises a ceiling, and the bar
       should show it without healing anybody. */
    refreshVitals(merged, false);
  }

  refreshLedger();
  publishProgress();
}

/* "# Players skills" for the administrateur's clipboard: one line per player,
   in sheet order, whether or not they are still connected. */
export function skillLines() {
  const out = [];
  state.roster.forEach((person) => {
    if (person.admin) return;
    const written = describeSkills(person.skills);
    out.push(person.name + ":" + (written || "no sheet loaded"));
  });
  return out;
}
