/* js/dialogue/sanitize.js */

/* The administrateur's turn payload, rebuilt field by field: a peer can only
   ever contribute shapes the reader already understands. No DOM here.

   Trees are keyed by character name or peer id; the reserved "inventory" key
   carries item orders instead and is rebuilt by inventory/items.js.

   A skillCheck comes in three shapes:
     1. No dice, no result — a passive read that only acts as a speaker.
     2. Passive, "mode": "passive" (or "passive": true / "hidden": true), with
        a difficulty. Not rolled: passive.js weighs it against the reader's own
        sheet. The administrateur only ever writes these as successes, so the
        result and any dice they carry are dropped here.
     3. Active with a visible roll — the default. Tape, dice, verdict. */

import { own, pick, line, normalizeKey, bodyText } from "./text.js";
import { INVENTORY_KEY, cleanOps } from "../inventory/items.js";

export const DIFFICULTY_TARGET = {
  trivial: 6,
  easy: 8,
  medium: 10,
  challenging: 12,
  formidable: 13,
  legendary: 14,
  heroic: 15,
  godly: 16,
  impossible: 18,
};

const RESULTS = { success: true, failure: true };

/* Names a payload may use for a check that is never rolled. */
const PASSIVE_MODES = { passive: true, hidden: true, silent: true };
const ACTIVE_MODES = { active: true, visible: true, open: true, rolled: true };

const MAX_PAYLOAD_CHARS = 200000;
const MAX_TREES = 16;
export const MAX_NODES = 240;
const MAX_OPTIONS = 8;
const KEY_MAX = 120;
const SPEAKER_MAX = 48;
const LABEL_MAX = 240;
const BODY_MAX = 4000;

/* "SUCCESS", "passed", "Critical failure" — anything that plainly reads as a
   verdict resolves to one of the two the overlay knows. */
function resolveResult(value) {
  const key = normalizeKey(value);
  if (!key) return "";
  if (own(RESULTS, key)) return key;
  if (/succ|pass|win/.test(key)) return "success";
  if (/fail|miss|lose|lost/.test(key)) return "failure";
  return "";
}

/* Active is the default, so a payload written before passives existed still
   rolls in the open. */
function resolvePassive(raw) {
  const mode = normalizeKey(raw.mode || raw.kind || raw.checkType);
  if (own(PASSIVE_MODES, mode)) return true;
  if (own(ACTIVE_MODES, mode)) return false;
  if (raw.passive === true || raw.hidden === true) return true;
  if (raw.hiddenDice === true || raw.hiddenRoll === true) return true;
  if (raw.active === false || raw.visible === false) return true;
  return false;
}

function dieValue(value) {
  const number = Math.round(Number(value));
  return isFinite(number) && number >= 1 && number <= 6 ? number : 0;
}

/* A pair may arrive as diceRoll/dice/roll, keyed dice1/die1/d1, as a two-slot
   array, or loose on the check. When none hold up the verdict shows faceless. */
function cleanDice(raw) {
  const sources = [raw.diceRoll, raw.dice, raw.roll, raw];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (!source || typeof source !== "object") continue;

    if (Array.isArray(source)) {
      const first = dieValue(source[0]);
      const second = dieValue(source[1]);
      if (first && second) return { dice1: first, dice2: second };
      continue;
    }

    const first = dieValue(
      source.dice1 != null
        ? source.dice1
        : source.die1 != null
          ? source.die1
          : source.d1 != null
            ? source.d1
            : source.first,
    );
    const second = dieValue(
      source.dice2 != null
        ? source.dice2
        : source.die2 != null
          ? source.die2
          : source.d2 != null
            ? source.d2
            : source.second,
    );
    if (first && second) return { dice1: first, dice2: second };
  }
  return { dice1: 0, dice2: 0 };
}

function cleanCheck(raw) {
  if (!raw || typeof raw !== "object") return null;

  const skill = line(raw.skill, 64);
  const result = resolveResult(raw.result);
  /* A verdict with no named skill is still a verdict worth showing. */
  if (!skill && !result) return null;

  const passive = resolvePassive(raw);
  const difficulty = normalizeKey(raw.difficulty);
  const dice = cleanDice(raw);
  const modifier = Math.round(Number(raw.modifier));

  return {
    skill,
    difficulty: own(DIFFICULTY_TARGET, difficulty) ? difficulty : "",
    /* A passive is only ever written as a success; whether the reader is
       sharp enough to see it is settled by passive.js, not here. */
    result: passive ? "success" : result,
    passive,
    /* No dice were thrown for a passive, so it shows none. */
    dice1: passive ? 0 : dice.dice1,
    dice2: passive ? 0 : dice.dice2,
    modifier: isFinite(modifier) ? Math.max(-20, Math.min(20, modifier)) : 0,
  };
}

function cleanVitals(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  ["vitality", "morale"].forEach((field) => {
    const direction = normalizeKey(raw[field]);
    if (direction === "gain" || direction === "loss") out[field] = direction;
  });
  return Object.keys(out).length ? out : null;
}

function cleanOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_OPTIONS; i += 1) {
    const option = raw[i];
    if (!option || typeof option !== "object") continue;
    const label = line(option.label, LABEL_MAX);
    if (!label) continue;
    out.push({
      id: line(option.id, KEY_MAX) || "opt-" + out.length,
      label,
      next: typeof option.next === "string" ? line(option.next, KEY_MAX) : null,
    });
  }
  return out;
}

function cleanNode(raw, id) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const dialogue = bodyText(raw.dialogue, BODY_MAX);
  const options = cleanOptions(raw.options);
  const check = cleanCheck(raw.skillCheck);
  if (!dialogue && !options.length && !check) return null;

  return {
    id,
    speaker: line(raw.speaker, SPEAKER_MAX),
    dialogue,
    next: typeof raw.next === "string" ? line(raw.next, KEY_MAX) : null,
    vitals: cleanVitals(raw.vitals),
    skillCheck: check,
    options,
  };
}

function cleanTree(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw.nodes;
  if (!source || typeof source !== "object" || Array.isArray(source))
    return null;

  const nodes = {};
  const ids = Object.keys(source);
  let kept = 0;
  for (let i = 0; i < ids.length && kept < MAX_NODES; i += 1) {
    const id = line(ids[i], KEY_MAX);
    if (!id || own(nodes, id)) continue;
    const node = cleanNode(source[ids[i]], id);
    if (!node) continue;
    nodes[id] = node;
    kept += 1;
  }

  const kepts = Object.keys(nodes);
  if (!kepts.length) return null;

  let root = line(raw.root, KEY_MAX);
  if (!root || !own(nodes, root)) root = kepts[0];
  return { root, nodes };
}

export function cleanPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  const keys = Object.keys(raw);
  let kept = 0;
  for (let i = 0; i < keys.length && kept < MAX_TREES; i += 1) {
    const key = line(keys[i], KEY_MAX);
    if (!key || own(out, key)) continue;
    if (normalizeKey(key) === INVENTORY_KEY) continue;
    const cleaned = cleanTree(raw[keys[i]]);
    if (!cleaned) continue;
    out[key] = cleaned;
    kept += 1;
  }
  return kept ? out : null;
}

/* The item orders riding along with the trees, or null when there are none. */
export function cleanInventoryOps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i += 1) {
    if (normalizeKey(keys[i]) === INVENTORY_KEY) return cleanOps(raw[keys[i]]);
  }
  return null;
}

function stripFence(text) {
  const trimmed = String(text == null ? "" : text).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/* A null payload with a null error and no inventory means the text was never
   meant to be a payload — speak it as prose instead. */
export function parsePayload(text) {
  const raw = stripFence(text);
  if (!raw || raw.charAt(0) !== "{") {
    return { payload: null, inventory: null, error: null, raw };
  }
  if (raw.length > MAX_PAYLOAD_CHARS) {
    return {
      payload: null,
      inventory: null,
      error: "That payload is too large to send.",
      raw,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      payload: null,
      inventory: null,
      error: "That looked like a turn payload, but the JSON is malformed.",
      raw,
    };
  }

  const payload = cleanPayload(parsed);
  const inventory = cleanInventoryOps(parsed);
  if (!payload && !inventory) {
    return {
      payload: null,
      inventory: null,
      error: "No usable dialogue trees or item orders in that payload.",
      raw,
    };
  }
  return { payload, inventory, error: null, raw };
}

/* Keys are character names or PeerJS ids — the id is tried first. */
export function pickTree(payload, selfId, name) {
  if (!payload) return null;
  if (own(payload, selfId)) return payload[selfId];

  const wanted = normalizeKey(name);
  if (!wanted) return null;
  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i += 1) {
    if (normalizeKey(keys[i]) === wanted) return payload[keys[i]];
  }
  return null;
}

export { pick };
