/* js/dialogue/passive.js */

/* Passive checks: what a reader notices on its own.

   A passive is never rolled. The administrateur only ever writes passives as
   successes, so whether one is noticed at all is settled here, against the
   reader's own sheet:

     skill value + PASSIVE_BONUS (+ the check's modifier) >= difficulty target

   One that clears its target reads as an ordinary line, tag and all. One that
   does not is never written: the player was simply not sharp enough, and the
   scene carries on without them knowing there was anything to miss.

   The sheet is handed in from outside, so nothing here reaches for the app. */

import { own } from "./text.js";
import { DIFFICULTY_TARGET } from "./sanitize.js";
import { findSkill } from "./skills.js";
import { skillScore } from "../vitals.js";

/* The passive's standing bonus, in place of two dice. */
export const PASSIVE_BONUS = 6;

let sheet = null;

export function setSheet(next) {
  sheet = next || null;
}

export function getSheet() {
  return sheet;
}

/* What the reader's own sheet is worth to a check, or null when there is
   nothing to reckon with: no skill named, an unknown one, or no sheet at all. */
export function skillValue(check) {
  if (!sheet || !check || !check.skill) return null;
  const found = findSkill(check.skill);
  if (!found) return null;
  return skillScore(sheet, found.id);
}

/* What the reader brings to a passive check: the sheet, plus the standing
   bonus that stands in for two dice. */
export function passiveScore(check) {
  const value = skillValue(check);
  if (value == null) return null;
  return value + PASSIVE_BONUS + (Number(check.modifier) || 0);
}

/* Whether a passive is noticed. Anything unreckonable is shown rather than
   swallowed: a line the player never sees cannot be got back, so the doubt
   falls their way. */
export function passes(check) {
  if (!check || !check.passive) return true;
  if (!own(DIFFICULTY_TARGET, check.difficulty)) return true;

  const score = passiveScore(check);
  if (score == null) return true;
  return score >= DIFFICULTY_TARGET[check.difficulty];
}

/* A node this reader never notices: stepped over by the live reader, and left
   out of a transcript for the same reason. */
export function blocksNode(node) {
  return Boolean(node && node.skillCheck && !passes(node.skillCheck));
}
