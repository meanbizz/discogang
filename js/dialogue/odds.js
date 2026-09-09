/* js/dialogue/odds.js */

/* The chance that 2d6, plus the reader's score in the check's skill, plus the
   check's own modifier meets the difficulty. Pure arithmetic, no DOM. */

import { skillValue } from "./passive.js";
import { skillLabel } from "./skills.js";
import { DIFFICULTY_TARGET, checkModifierTotal } from "./sanitize.js";

/* How many of the 36 throws land on each sum of two dice, index 0–12. */
const SUMS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];

/* What a chance reads as, in words: only the ends are fixed — nothing at
   all, and everything. */
function oddsLabel(odds) {
  if (odds <= 0) return "impossible";
  if (odds >= 100) return "certain";
  if (odds < 20) return "very low";
  if (odds < 40) return "low";
  if (odds < 60) return "even";
  if (odds < 80) return "high";
  return "very high";
}

/* One rolled check, priced: the skill and this reader's score in it, the
   chance and the words it reads as. Null when there is nothing to reckon. */
export function oddsFor(check) {
  if (!check || !check.result || check.passive) return null;
  const target = DIFFICULTY_TARGET ? DIFFICULTY_TARGET[check.difficulty] : undefined;
  if (typeof target !== "number") return null;

  const score = skillValue(check) || 0;
  const need = target - score - checkModifierTotal(check);
  let odds;

  if (need <= 2) odds = 100;
  else if (need > 12) odds = 0;
  else {
    let ways = 0;
    for (let sum = need; sum <= 12; sum += 1) ways += SUMS[sum];
    odds = Math.round((ways / 36) * 100);
  }

  return {
    skill: skillLabel(check.skill),
    score,
    odds,
    /* Lowest 2d6 sum that still passes; floored at 2, the smallest throw. */
    minRoll: Math.max(2, need),
    label: oddsLabel(odds),
    /* Already sorted lowest first by the sieve that cleaned them. */
    modifiers: Array.isArray(check.modifiers) ? check.modifiers : [],
  };
}
