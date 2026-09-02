/* js/export/character.js */

/* One player's character, written out for them to keep: what their sheet
   holds, what they are carrying, and where their two bars stand.

   The shape is deliberately the one the join form already reads. Attributes
   are plain numbers and every skill keeps its points and its signature, so a
   file written here can be handed straight back to the stats picker next
   session — the sheet's own normalize is what caps it on the way in. The rest
   is written for whoever opens the file: each skill's title and score, the
   counts in the bag, and the two bars against their ceilings. None of it is
   read back.

   A session save is still the room's record. This is the player's. Pure: no
   DOM, no network. */

import { cleanName } from "../utils.js";
import {
  orderedSkillIds,
  skillGroups,
  skillScores,
  skillTitle,
} from "../sheet.js";
import { stamp } from "./file.js";

export const CHARACTER_KIND = "salon-character";
export const CHARACTER_VERSION = 1;

const SLUG_MAX = 24;

function own(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

function count(value, fallback) {
  const number = Math.round(Number(value));
  return isFinite(number) && number >= 0 ? number : fallback;
}

/* One number per attribute, in the sheet's own order, so the file reads the
   way the cards are laid out. */
function attributesOf(sheetState) {
  const held = (sheetState && sheetState.attributes) || {};
  const out = {};
  skillGroups().forEach((group) => {
    out[group.id] = count(held[group.id], 1) || 1;
  });
  return out;
}

/* points and signature are the two fields the sheet reads back; name and
   score are for the reader. */
function skillsOf(sheetState) {
  const held = (sheetState && sheetState.skills) || {};
  const scores = skillScores(sheetState);
  const out = {};
  orderedSkillIds().forEach((id) => {
    const skill = held[id] || {};
    out[id] = {
      name: skillTitle(id),
      points: count(skill.points, 0),
      signature: Boolean(skill.signature),
      score: own(scores, id) ? scores[id] : 0,
    };
  });
  return out;
}

/* The bag as the grid shows it. Nameless entries cannot be anything, so they
   are left out — but a count of none is kept: an empty purse is a reading,
   and rounding it up to one would hand the player money they never had. */
function inventoryOf(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      name: String(item && item.name ? item.name : ""),
      count: count(item && item.count, 0),
      description: String(item && item.description ? item.description : ""),
      image: item && item.image ? item.image : null,
    }))
    .filter((item) => item.name);
}

/* A bar and the ceiling its skill gives it, so the number means something
   next to a sheet that may have moved since. */
function barOf(bar) {
  const max = count(bar && bar.max, 0);
  return { value: Math.min(max, count(bar && bar.value, 0)), max };
}

export function snapshot(source) {
  const from = source || {};
  return {
    kind: CHARACTER_KIND,
    version: CHARACTER_VERSION,
    savedAt: new Date().toISOString(),
    name: cleanName(from.name),
    attributes: attributesOf(from.sheetState),
    skills: skillsOf(from.sheetState),
    inventory: inventoryOf(from.items),
    vitals: {
      health: barOf(from.vitals && from.vitals.health),
      morale: barOf(from.vitals && from.vitals.morale),
    },
  };
}

/* "salon-harry-du-bois-sheet-20260902-0815.json" — the character's own name
   where a session save carries the room code. */
export function fileName(snap) {
  const who = String((snap && snap.name) || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return "salon-" + (who || "character") + "-sheet-" + stamp() + ".json";
}
