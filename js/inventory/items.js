/* js/inventory/items.js */

/* Items and who holds them. An item is named, pictured and described; a
   holder's bag is a count per item name. The name is the identity, so bags
   and catalogues are read case-insensitively.

   One item is not the administrateur's to invent or to withdraw: the Reál is
   the money every character carries, and it is seeded into every catalogue
   that passes through here. That is why the seeding lives in cleanItems and
   nowhere else — a welcome, a save, a payload's orders and a fresh room all
   come through that one door, so none of them can arrive without it.

   Names that plainly mean the money — real, REAL, reals, an á written as two
   characters instead of one — are folded to the one spelling before anything
   else looks at them. Otherwise a payload written in a hurry would open a
   second purse beside the first and the table would hold two kinds of money.

   An administrateur's payload may carry add/update/remove orders under the
   reserved "inventory" key; they are rebuilt here before anything moves.
   No DOM and no network. */

import { cleanImageUrl } from "../utils.js";
import { cleanModifiers } from "../modifiers/modifiers.js";

export const INVENTORY_KEY = "inventory";

/* The money. The mark is its face on a square — a purse has no portrait. */
export const CURRENCY_NAME = "Reál";
export const CURRENCY_MARK = "✤";
export const CURRENCY_DESC =
  "Currency used by countries in the Reál Belt.";

/* Everything that means the money. Only whole words: "Real Estate" is an
   item, "reals" is a purse. */
const CURRENCY_KEYS = {
  "reál": true,
  "reáls": true,
  réal: true,
  réals: true,
  real: true,
  reals: true,
};

const NAME_MAX = 48;
const DESC_MAX = 600;
const MAX_ITEMS = 256;
const MAX_HOLDERS = 32;
const MAX_COUNT = 999;

/* Targets that mean every player at the table. */
const EVERYONE = { "*": true, all: true, everyone: true, players: true };

function has(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

/* Two spellings of the same accent are the same name. Composed first, so a
   decomposed á off the wire matches the one written here. */
function fold(value) {
  const text = String(value == null ? "" : value);
  try {
    return text.normalize ? text.normalize("NFC") : text;
  } catch (error) {
    return text;
  }
}

function line(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function body(value, max) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/* Whether a name means the money, asked before any canonicalising so it can
   be used from inside itemName without circling. */
export function isCurrency(value) {
  return has(CURRENCY_KEYS, line(fold(value), NAME_MAX).toLowerCase());
}

/* Every name in the app comes through here, which is what makes the money one
   name rather than six. */
export function itemName(value) {
  const name = line(fold(value), NAME_MAX);
  return isCurrency(name) ? CURRENCY_NAME : name;
}

export function itemKey(value) {
  return itemName(value).toLowerCase();
}

const CURRENCY_KEY = CURRENCY_NAME.toLowerCase();

export function currencyItem() {
  return {
    name: CURRENCY_NAME,
    image: null,
    description: CURRENCY_DESC,
    modifiers: [],
  };
}

function tally(value, fallback) {
  const number = Math.round(Number(value));
  if (!isFinite(number)) return fallback;
  return Math.max(0, Math.min(MAX_COUNT, number));
}

export function cleanItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = itemName(raw.name);
  if (!name) return null;
  return {
    name,
    image: cleanImageUrl(raw.image),
    description: body(raw.description, DESC_MAX),
    /* What carrying it does to a score, for as long as it is carried. */
    modifiers: cleanModifiers(raw.modifiers),
  };
}

/* The money, put where it belongs: first, described, and present whether the
   list that arrived knew about it or not. Whatever the administrateur has
   written on it otherwise is left alone. */
function withCurrency(items) {
  for (let i = 0; i < items.length; i += 1) {
    if (itemKey(items[i].name) !== CURRENCY_KEY) continue;
    if (!items[i].description) items[i].description = CURRENCY_DESC;
    if (i > 0) items.unshift(items.splice(i, 1)[0]);
    return items;
  }
  items.unshift(currencyItem());
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
  return items;
}

export function cleanItems(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < source.length && out.length < MAX_ITEMS; i += 1) {
    const item = cleanItem(source[i]);
    if (!item) continue;
    const key = itemKey(item.name);
    if (has(seen, key)) continue;
    seen[key] = true;
    out.push(item);
  }
  return withCurrency(out);
}

export function findItem(items, name) {
  const key = itemKey(name);
  if (!key || !Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i += 1) {
    if (itemKey(items[i].name) === key) return items[i];
  }
  return null;
}

/* { "Harry": { "Cigarette": 2 } }

   Two names that fold to the same item are added together rather than one
   quietly winning: a hand-edited save holding both "real" and "Reál" is
   somebody's money, and losing half of it would be worse than either. */
export function cleanInventories(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  const holders = Object.keys(raw);
  let kept = 0;

  for (let i = 0; i < holders.length && kept < MAX_HOLDERS; i += 1) {
    const holder = line(holders[i], NAME_MAX);
    const bag = raw[holders[i]];
    if (!holder || !bag || typeof bag !== "object" || Array.isArray(bag)) {
      continue;
    }
    if (has(out, holder)) continue;

    const kepts = {};
    const under = Object.create(null);
    const names = Object.keys(bag);
    let held = 0;
    for (let j = 0; j < names.length && held < MAX_ITEMS; j += 1) {
      const name = itemName(names[j]);
      const count = tally(bag[names[j]], 0);
      if (!name || !count) continue;
      const key = name.toLowerCase();
      if (has(under, key)) {
        kepts[under[key]] = tally(kepts[under[key]] + count, MAX_COUNT);
        continue;
      }
      under[key] = name;
      kepts[name] = count;
      held += 1;
    }
    out[holder] = kepts;
    kept += 1;
  }
  return out;
}

/* count null means "as many as there are": one to give, all to take. */
function order(raw) {
  const source = typeof raw === "string" ? { name: raw } : raw;
  const item = cleanItem(source);
  if (!item) return null;
  item.count = source.count == null ? null : tally(source.count, 1);
  return item;
}

function orders(raw) {
  const source = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (let i = 0; i < source.length && out.length < MAX_ITEMS; i += 1) {
    const kept = order(source[i]);
    if (kept) out.push(kept);
  }
  return out;
}

/* { "Harry": { add: […], update: […], remove: […] } }. A bare array under a
   holder reads as "add"; "*" means every player. Null when nothing holds up. */
export function cleanOps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  const targets = Object.keys(raw);
  let kept = 0;

  for (let i = 0; i < targets.length && kept < MAX_HOLDERS; i += 1) {
    const target = line(targets[i], NAME_MAX);
    const source = raw[targets[i]];
    if (!target || !source || typeof source !== "object") continue;

    const asked = Array.isArray(source)
      ? { add: orders(source), update: [], remove: [] }
      : {
          add: orders(source.add || source.give),
          update: orders(source.update || source.set),
          remove: orders(source.remove || source.take),
        };
    if (!asked.add.length && !asked.update.length && !asked.remove.length) {
      continue;
    }
    out[target] = asked;
    kept += 1;
  }
  return kept ? out : null;
}

function bagFor(inventories, holder) {
  const key = itemKey(holder);
  const holders = Object.keys(inventories);
  for (let i = 0; i < holders.length; i += 1) {
    if (itemKey(holders[i]) === key) return inventories[holders[i]];
  }
  inventories[holder] = {};
  return inventories[holder];
}

function heldName(bag, name) {
  const key = itemKey(name);
  const names = Object.keys(bag);
  for (let i = 0; i < names.length; i += 1) {
    if (itemKey(names[i]) === key) return names[i];
  }
  return null;
}

/* The catalogue learns whatever the order describes, without forgetting what
   it already knew. */
function remember(items, asked) {
  const found = findItem(items, asked.name);
  if (!found) {
    if (items.length >= MAX_ITEMS) return;
    items.push({
      name: asked.name,
      image: asked.image,
      description: asked.description,
      modifiers: asked.modifiers,
    });
    return;
  }
  if (asked.image) found.image = asked.image;
  if (asked.description) found.description = asked.description;
  if (asked.modifiers && asked.modifiers.length) {
    found.modifiers = asked.modifiers;
  }
}

function give(bag, asked) {
  const held = heldName(bag, asked.name);
  const step = asked.count == null ? 1 : asked.count;
  if (!step) return;
  if (held) bag[held] = Math.min(MAX_COUNT, bag[held] + step);
  else bag[asked.name] = step;
}

function set(bag, asked) {
  const held = heldName(bag, asked.name);
  if (asked.count == null) {
    if (!held) bag[asked.name] = 1;
    return;
  }
  if (!asked.count) {
    if (held) delete bag[held];
    return;
  }
  if (held) bag[held] = asked.count;
  else bag[asked.name] = asked.count;
}

function take(bag, asked) {
  const held = heldName(bag, asked.name);
  if (!held) return;
  if (asked.count == null) {
    delete bag[held];
    return;
  }
  const left = bag[held] - asked.count;
  if (left > 0) bag[held] = left;
  else delete bag[held];
}

/* Returns a fresh { items, inventories }; the arguments are left alone. */
export function applyOps(store, ops, everyone) {
  const items = cleanItems(store && store.items);
  const inventories = cleanInventories(store && store.inventories);
  if (!ops) return { items, inventories };

  Object.keys(ops).forEach((target) => {
    const holders = EVERYONE[itemKey(target)] ? everyone || [] : [target];
    holders.forEach((holder) => {
      const name = line(holder, NAME_MAX);
      if (!name) return;
      const bag = bagFor(inventories, name);
      const asked = ops[target];
      asked.add.forEach((one) => {
        remember(items, one);
        give(bag, one);
      });
      asked.update.forEach((one) => {
        remember(items, one);
        set(bag, one);
      });
      asked.remove.forEach((one) => take(bag, one));
    });
  });
  return { items, inventories };
}

/* Item names written as [Cigarette] inside a plan, once each, in the order
   they were written. */
export function mentionedNames(texts) {
  const seen = Object.create(null);
  const out = [];
  (Array.isArray(texts) ? texts : []).forEach((text) => {
    const pattern = /\[([^\][]{1,48})\]/g;
    let match;
    while ((match = pattern.exec(String(text == null ? "" : text)))) {
      const name = itemName(match[1]);
      const key = name.toLowerCase();
      if (!key || has(seen, key)) continue;
      seen[key] = true;
      out.push(name);
    }
  });
  return out;
}
