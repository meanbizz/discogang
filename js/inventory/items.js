/* js/inventory/items.js */

/* Items and who holds them. An item is named, pictured and described; a
   holder's bag is a count per item name. The name is the identity, so bags
   and catalogues are read case-insensitively.

   An administrateur's payload may carry add/update/remove orders under the
   reserved "inventory" key; they are rebuilt here before anything moves.
   No DOM and no network. */

import { cleanImageUrl } from "../utils.js";

export const INVENTORY_KEY = "inventory";

const NAME_MAX = 48;
const DESC_MAX = 600;
const MAX_ITEMS = 256;
const MAX_HOLDERS = 32;
const MAX_COUNT = 999;

/* Targets that mean every player at the table. */
const EVERYONE = { "*": true, all: true, everyone: true, players: true };

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

export function itemName(value) {
  return line(value, NAME_MAX);
}

export function itemKey(value) {
  return itemName(value).toLowerCase();
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
  };
}

export function cleanItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = {};
  for (let i = 0; i < raw.length && out.length < MAX_ITEMS; i += 1) {
    const item = cleanItem(raw[i]);
    if (!item) continue;
    const key = itemKey(item.name);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(item);
  }
  return out;
}

export function findItem(items, name) {
  const key = itemKey(name);
  if (!key || !Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i += 1) {
    if (itemKey(items[i].name) === key) return items[i];
  }
  return null;
}

/* { "Harry": { "Cigarette": 2 } } */
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
    if (Object.prototype.hasOwnProperty.call(out, holder)) continue;

    const kepts = {};
    const names = Object.keys(bag);
    let held = 0;
    for (let j = 0; j < names.length && held < MAX_ITEMS; j += 1) {
      const name = itemName(names[j]);
      const count = tally(bag[names[j]], 0);
      if (!name || !count) continue;
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
    });
    return;
  }
  if (asked.image) found.image = asked.image;
  if (asked.description) found.description = asked.description;
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
  const seen = {};
  const out = [];
  (Array.isArray(texts) ? texts : []).forEach((text) => {
    const pattern = /\[([^\][]{1,48})\]/g;
    let match;
    while ((match = pattern.exec(String(text == null ? "" : text)))) {
      const name = itemName(match[1]);
      const key = itemKey(name);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(name);
    }
  });
  return out;
}
