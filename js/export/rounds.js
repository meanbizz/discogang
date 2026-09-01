/* The dialogue history a save is written from: one entry per round, each
   holding every character's tree as that round sent them. */

import { DIALOGUE_ROUND_LIMIT } from "../config.js";
import { uid } from "../utils.js";
import { cleanPayload } from "../dialogue/sanitize.js";

export const ROUND_ID_MAX = 64;

function cleanRound(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = cleanPayload(raw.payload);
  if (!payload) return null;
  return {
    id:
      typeof raw.id === "string" && raw.id
        ? raw.id.slice(0, ROUND_ID_MAX)
        : uid(),
    at: Number(raw.at) || 0,
    payload,
  };
}

/* The oldest rounds fall off the front. fallback is for version 1 saves and
   for any peer that only ever knew the live payload: a lone payload becomes
   the single round of its history rather than being dropped. */
export function cleanRounds(raw, fallback) {
  const out = [];
  if (Array.isArray(raw)) {
    const source =
      raw.length > DIALOGUE_ROUND_LIMIT
        ? raw.slice(-DIALOGUE_ROUND_LIMIT)
        : raw;
    for (let i = 0; i < source.length; i += 1) {
      const round = cleanRound(source[i]);
      if (round) out.push(round);
    }
  }
  if (out.length) return out;

  const single = cleanPayload(fallback);
  return single ? [{ id: uid(), at: 0, payload: single }] : [];
}

export function latestPayload(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) return null;
  const last = rounds[rounds.length - 1];
  return last && last.payload ? last.payload : null;
}
