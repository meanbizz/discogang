/* js/xp.js */

/* One seat's experience: what it has earned, how far it is from the next
   skill point, and how many points are waiting to be spent.

   The ledger is the seat's own — it is published to the table for the
   administrateur to read and for a save to remember, but nobody else's copy
   is ever authoritative here. Pure state and arithmetic: no DOM, no network,
   no animation. */

import { XP_PER_POINT, XP_MAX_PER_NODE, XP_MAX_TOTAL } from "./config.js";

const MAX_POINTS = 999;

export const xp = {
  /* Everything earned this campaign. */
  total: 0,
  /* Progress towards the next point, so current is always below required. */
  current: 0,
  required: XP_PER_POINT,
  /* Earned and not yet turned into a pip. */
  points: 0,
  spent: 0,
};

export function resetXp() {
  xp.total = 0;
  xp.current = 0;
  xp.required = XP_PER_POINT;
  xp.points = 0;
  xp.spent = 0;
}

/* What the sheet's header prints. */
export function ledger() {
  return {
    points: xp.points,
    current: xp.current,
    required: xp.required,
    total: xp.total,
    spent: xp.spent,
  };
}

export function xpPayload() {
  return {
    total: xp.total,
    current: xp.current,
    required: xp.required,
    points: xp.points,
    spent: xp.spent,
  };
}

function amountOf(value, ceiling) {
  const number = Math.round(Number(value));
  if (!isFinite(number) || number <= 0) return 0;
  return Math.min(ceiling, number);
}

/* Returns what actually landed: { gained, granted } — granted being how many
   skill points that pushed over the line, usually one and occasionally more. */
export function grantXp(amount) {
  const gained = amountOf(amount, XP_MAX_PER_NODE);
  if (!gained) return { gained: 0, granted: 0 };

  xp.total = Math.min(XP_MAX_TOTAL, xp.total + gained);
  xp.current += gained;

  let granted = 0;
  while (xp.current >= xp.required && xp.points < MAX_POINTS) {
    xp.current -= xp.required;
    xp.points += 1;
    granted += 1;
  }
  if (xp.current < 0) xp.current = 0;
  return { gained, granted };
}

/* Returns whether there was a point to spend. */
export function spendPoint() {
  if (xp.points <= 0) return false;
  xp.points -= 1;
  xp.spent += 1;
  return true;
}

/* For a spend the sheet then refused. */
export function refundPoint() {
  if (xp.spent <= 0) return;
  xp.spent -= 1;
  xp.points = Math.min(MAX_POINTS, xp.points + 1);
}

/* A ledger off the wire or out of a save, rebuilt field by field. */
export function cleanXpLedger(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const required = Math.round(Number(raw.required));
  const out = {
    total: amountOf(raw.total, XP_MAX_TOTAL),
    current: amountOf(raw.current, XP_MAX_TOTAL),
    required:
      isFinite(required) && required > 0
        ? Math.min(XP_MAX_TOTAL, required)
        : XP_PER_POINT,
    points: amountOf(raw.points, MAX_POINTS),
    spent: amountOf(raw.spent, MAX_POINTS),
  };
  /* A ledger claiming more progress than a point costs has already earned it,
     which is the host's arithmetic and not ours to invent. */
  if (out.current >= out.required) out.current = out.required - 1;
  return out;
}

export function setXp(raw) {
  const held = cleanXpLedger(raw);
  if (!held) {
    resetXp();
    return;
  }
  xp.total = held.total;
  xp.current = held.current;
  xp.required = held.required;
  xp.points = held.points;
  xp.spent = held.spent;
}
