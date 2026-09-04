/* js/modifiers/modifiers.js */

/* What raises and lowers a score, and for how long.

   Two kinds, and the difference between them is the whole of this module. An
   item's modifiers stand while the item is in the bag, and they name skills. A
   consumed item's stand until the administrateur takes them away, and they name
   attributes — which is why they arrive as orders rather than as items: nothing
   in this app consumes anything, the payload says what was consumed and what
   it was. The [label] the payload writes is carried through so the player can
   see what is working on them and not merely that something is.

   Targets are read against the sheet's own build, so a payload cannot move a
   score nothing prints. Where there is no build to read — the stats script
   never loaded — anything name-shaped is accepted rather than swallowed.

   No DOM and no network. */

import {
  MODIFIER_MAX,
  MODIFIERS_PER_ITEM,
  MODIFIER_HOLDERS,
} from "../config.js";
import {
  attributeTitle,
  orderedSkillIds,
  skillGroups,
  skillTitle,
} from "../sheet.js";

export const MODIFIERS_KEY = "temporary_modifiers";

/* Everything a payload may plausibly write the reserved key as. */
const KEY_NAMES = {
  temporary_modifiers: true,
  temporarymodifiers: true,
  temporary: true,
  modifiers: true,
};

const NAME_MAX = 48;
const LABEL_MAX = 48;
const MAX_ENTRIES = 64;
const TOTAL_MAX = 20;

const EVERYONE = { "*": true, all: true, everyone: true, players: true };

function has(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

function line(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* "HAND / EYE COORDINATION", "Physical Instrument", "half_light" — all of them
   fold to the id the sheet knows them by. */
function slug(value) {
  return line(value, NAME_MAX)
    .toLowerCase()
    .replace(/[\s_/]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* "[Speed]" is how the administrateur names what did it; the brackets are not
   part of the name. */
function label(value) {
  return line(value, LABEL_MAX)
    .replace(/^\[+/, "")
    .replace(/\]+$/, "")
    .trim();
}

function noBuild() {
  return !skillGroups().length;
}

function knownSkill(id) {
  return orderedSkillIds().indexOf(id) >= 0;
}

function knownAttribute(id) {
  const groups = skillGroups();
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i].id === id) return true;
  }
  return false;
}

export function isModifiersKey(value) {
  const key = line(value, NAME_MAX).toLowerCase();
  return has(KEY_NAMES, key) || has(KEY_NAMES, key.replace(/[\s-]+/g, "_"));
}

/* "+2", 2 and "2" are the same movement; nothing is a movement at all. */
function amountOf(value) {
  const number = Math.round(Number(value));
  if (!isFinite(number) || !number) return 0;
  return Math.max(-MODIFIER_MAX, Math.min(MODIFIER_MAX, number));
}

function sum(held, amount) {
  const total = (Number(held) || 0) + amount;
  return Math.max(-TOTAL_MAX, Math.min(TOTAL_MAX, total));
}

/* A bare number is an amount; an object is read field by field. */
function fields(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return { amount: raw };
  return Object.assign({}, raw);
}

/* One item's entry: a named skill and how far it moves it. */
function skillEntry(raw) {
  const source = fields(raw);
  if (!source) return null;
  const id = slug(
    source.skill || source.target || source.stat || source.name || "",
  );
  const amount = amountOf(
    source.amount != null
      ? source.amount
      : source.value != null
        ? source.value
        : source.modifier != null
          ? source.modifier
          : source.points,
  );
  if (!id || !amount) return null;
  if (!noBuild() && !knownSkill(id)) return null;
  return { skill: id, amount };
}

/* One consumed item's entry: a named attribute, how far it moves it, and the
   item that did it. */
function temporaryEntry(raw) {
  const source = fields(raw);
  if (!source) return null;
  const id = slug(
    source.attribute || source.target || source.stat || source.name || "",
  );
  const amount = amountOf(
    source.amount != null
      ? source.amount
      : source.value != null
        ? source.value
        : source.modifier,
  );
  if (!id || !amount) return null;
  if (!noBuild() && !knownAttribute(id)) return null;
  return {
    attribute: id,
    amount,
    from: label(source.from || source.item || source.source || source.label),
  };
}

/* A list, a map of target to amount, or the form's own text — all three are
   ways of writing the same thing. */
export function cleanModifiers(raw) {
  const out = [];
  const seen = Object.create(null);

  const push = (entry) => {
    if (!entry || out.length >= MODIFIERS_PER_ITEM) return;
    if (has(seen, entry.skill)) return;
    seen[entry.skill] = true;
    out.push(entry);
  };

  if (typeof raw === "string") return parseModifierLines(raw);
  if (Array.isArray(raw)) {
    raw.forEach((one) => push(skillEntry(one)));
    return out;
  }
  if (raw && typeof raw === "object") {
    Object.keys(raw).forEach((key) => {
      const held = raw[key];
      const source =
        held && typeof held === "object" && !Array.isArray(held)
          ? Object.assign({}, held)
          : { amount: held };
      if (!source.skill && !source.target) source.skill = key;
      push(skillEntry(source));
    });
  }
  return out;
}

export function cleanTemporary(raw) {
  const out = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length && out.length < MAX_ENTRIES; i += 1) {
      const kept = temporaryEntry(raw[i]);
      if (kept) out.push(kept);
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length && out.length < MAX_ENTRIES; i += 1) {
      const held = raw[keys[i]];
      const source =
        held && typeof held === "object" && !Array.isArray(held)
          ? Object.assign({}, held)
          : { amount: held };
      if (!source.attribute && !source.target) source.attribute = keys[i];
      const kept = temporaryEntry(source);
      if (kept) out.push(kept);
    }
  }
  return out;
}

/* { "Harry": [ … ] } — what is working on each seat, as a save and a welcome
   carry it. */
export function cleanTemporaryBooks(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  const holders = Object.keys(raw);
  let kept = 0;

  for (let i = 0; i < holders.length && kept < MODIFIER_HOLDERS; i += 1) {
    const holder = line(holders[i], NAME_MAX);
    if (!holder || has(out, holder)) continue;
    const held = cleanTemporary(raw[holders[i]]);
    if (!held.length) continue;
    out[holder] = held;
    kept += 1;
  }
  return out;
}

/* A name means an attribute if the build knows one, and the item that granted
   it otherwise: "physique" takes the attribute away, "[Speed]" takes back
   whatever that item gave. */
function removal(raw) {
  if (typeof raw === "string") {
    const id = slug(raw);
    if (id && knownAttribute(id)) return { attribute: id, from: "" };
    const from = label(raw);
    return from ? { attribute: "", from } : null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = slug(raw.attribute || raw.target || raw.stat || "");
  const from = label(raw.from || raw.item || raw.source || raw.label);
  if (!id && !from) return null;
  return { attribute: id, from };
}

function removals(raw) {
  const source = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out = [];
  for (let i = 0; i < source.length && out.length < MAX_ENTRIES; i += 1) {
    const kept = removal(source[i]);
    if (kept) out.push(kept);
  }
  return out;
}

/* { "Harry": [ … ] } replaces that seat's list wholesale — an empty array is
   how a seat is cleared. The long form takes add, set and remove; "*" means
   every player. Null when nothing holds up. */
export function cleanTemporaryOps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  const targets = Object.keys(raw);
  let kept = 0;

  for (let i = 0; i < targets.length && kept < MODIFIER_HOLDERS; i += 1) {
    const target = line(targets[i], NAME_MAX);
    const source = raw[targets[i]];
    if (!target || source == null || typeof source !== "object") continue;

    let asked;
    if (Array.isArray(source)) {
      asked = {
        set: cleanTemporary(source),
        add: [],
        remove: [],
        clear: !source.length,
      };
    } else {
      const written = source.set != null ? source.set : source.replace;
      asked = {
        set: written == null ? null : cleanTemporary(written),
        add: cleanTemporary(source.add || source.gain),
        remove: removals(source.remove || source.lose || source.take),
        clear:
          Boolean(source.clear) || (Array.isArray(written) && !written.length),
      };
    }

    if (
      !asked.clear &&
      !asked.set &&
      !asked.add.length &&
      !asked.remove.length
    ) {
      continue;
    }
    out[target] = asked;
    kept += 1;
  }
  return kept ? out : null;
}

function everyoneMeant(target) {
  return (
    has(EVERYONE, line(target, NAME_MAX).toLowerCase()) ||
    has(EVERYONE, slug(target))
  );
}

function holderKey(books, name) {
  const wanted = slug(name);
  const holders = Object.keys(books);
  for (let i = 0; i < holders.length; i += 1) {
    if (slug(holders[i]) === wanted) return holders[i];
  }
  return name;
}

function sameLabel(a, b) {
  return slug(a) === slug(b);
}

/* Returns fresh books; the arguments are left alone. */
export function applyTemporaryOps(books, ops, everyone) {
  const out = cleanTemporaryBooks(books);
  if (!ops) return out;

  Object.keys(ops).forEach((target) => {
    const holders = everyoneMeant(target) ? everyone || [] : [target];
    const asked = ops[target];

    holders.forEach((holder) => {
      const name = line(holder, NAME_MAX);
      if (!name) return;
      const key = holderKey(out, name);

      let held =
        asked.clear || asked.set ? [] : ((out[key] || []).slice() || []);
      if (asked.set) held = asked.set.slice();

      asked.add.forEach((entry) => {
        if (held.length < MAX_ENTRIES) held.push(entry);
      });

      if (asked.remove.length) {
        held = held.filter(
          (entry) =>
            !asked.remove.some(
              (cut) =>
                (!cut.attribute || cut.attribute === entry.attribute) &&
                (!cut.from || sameLabel(cut.from, entry.from)),
            ),
        );
      }

      if (held.length) out[key] = held;
      else delete out[key];
    });
  });
  return out;
}

/* One character's whole standing: skills from what they carry, attributes from
   what they took, and the sources behind both for whoever reads the list. */
export function activeSet(held, temporary) {
  const skills = {};
  const attributes = {};
  const sources = [];

  (Array.isArray(held) ? held : []).forEach((entry) => {
    if (!entry || !entry.skill || !entry.amount) return;
    skills[entry.skill] = sum(skills[entry.skill], entry.amount);
    sources.push({
      kind: "skill",
      target: entry.skill,
      amount: entry.amount,
      from: entry.from || "",
      temporary: false,
    });
  });

  (Array.isArray(temporary) ? temporary : []).forEach((entry) => {
    if (!entry || !entry.attribute || !entry.amount) return;
    attributes[entry.attribute] = sum(attributes[entry.attribute], entry.amount);
    sources.push({
      kind: "attribute",
      target: entry.attribute,
      amount: entry.amount,
      from: entry.from || "",
      temporary: true,
    });
  });

  return { skills, attributes, sources };
}

export function emptySet() {
  return { skills: {}, attributes: {}, sources: [] };
}

function signed(amount) {
  return (amount > 0 ? "+" : "−") + Math.abs(amount);
}

/* "Logic +1 [Notebook]" — one line of the player's list, and one part of the
   administrateur's. */
export function describeSource(entry) {
  if (!entry) return "";
  const title =
    entry.kind === "attribute"
      ? attributeTitle(entry.target)
      : skillTitle(entry.target);
  return (
    title +
    " " +
    signed(entry.amount) +
    (entry.from ? " [" + entry.from + "]" : "") +
    (entry.temporary ? " (temporary)" : "")
  );
}

export function describeActive(active) {
  const sources = active && Array.isArray(active.sources) ? active.sources : [];
  return sources.map(describeSource).join(", ");
}

/* An item's own modifiers, for the catalogue row and the tooltip. */
export function describeModifierList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((entry) => entry && entry.skill && entry.amount)
    .map((entry) => skillTitle(entry.skill) + " " + signed(entry.amount))
    .join(", ");
}

/* One per line, "Logic: +2", which is what the item form's field holds. */
export function parseModifierLines(text) {
  const rows = String(text == null ? "" : text).split(/[\n,;]+/);
  const out = [];
  const seen = Object.create(null);

  for (let i = 0; i < rows.length && out.length < MODIFIERS_PER_ITEM; i += 1) {
    const row = rows[i].trim();
    if (!row) continue;
    const match = row.match(/^(.*?)[\s:=]+([+-]?\d+)$/);
    if (!match) continue;
    const entry = skillEntry({ skill: match[1], amount: match[2] });
    if (!entry || has(seen, entry.skill)) continue;
    seen[entry.skill] = true;
    out.push(entry);
  }
  return out;
}

export function writeModifierLines(list) {
  return (Array.isArray(list) ? list : [])
    .filter((entry) => entry && entry.skill && entry.amount)
    .map(
      (entry) =>
        skillTitle(entry.skill) +
        ": " +
        (entry.amount > 0 ? "+" : "") +
        entry.amount,
    )
    .join("\n");
}
