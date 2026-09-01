/* js/app/inventory.js */

/* Items from the app's side: what each character holds, the catalogue of
   everything in play, and the payload orders that move items around.

   The host is the only seat that mutates any of it; everybody else is told. */

import { dom } from "../dom.js";
import { holdImage } from "../assets.js";
import * as modals from "../modals.js";
import {
  applyOps,
  cleanItem,
  cleanItems,
  cleanInventories,
  findItem,
  itemKey,
  itemName,
  mentionedNames,
} from "../inventory/items.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";

function holderNames() {
  const out = [];
  state.roster.forEach((person) => {
    if (!person.admin && person.name) out.push(person.name);
  });
  return out;
}

function bagOf(holder) {
  const key = itemKey(holder);
  const holders = Object.keys(state.inventories);
  for (let i = 0; i < holders.length; i += 1) {
    if (itemKey(holders[i]) === key) return state.inventories[holders[i]];
  }
  return null;
}

/* What one character carries, described from the catalogue. */
export function heldBy(holder) {
  const bag = bagOf(holder) || {};
  const out = [];
  Object.keys(bag).forEach((name) => {
    const count = bag[name];
    if (!count) return;
    const known = findItem(state.items, name);
    out.push({
      name: known ? known.name : name,
      image: known ? known.image : null,
      description: known ? known.description : "",
      count,
    });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function selfItems() {
  return heldBy(state.profile.name);
}

function totalHeld(name) {
  const key = itemKey(name);
  let total = 0;
  Object.keys(state.inventories).forEach((holder) => {
    const bag = state.inventories[holder];
    Object.keys(bag).forEach((held) => {
      if (itemKey(held) === key) total += bag[held];
    });
  });
  return total;
}

export function refreshViews() {
  if (state.isAdmin) {
    modals.renderItemList(state.items, editItem, removeItem);
    return;
  }
  modals.renderInventoryGrid(selfItems(), pickItem);
}

export function setInventory(rawItems, rawInventories) {
  state.items = cleanItems(rawItems);
  state.inventories = cleanInventories(rawInventories);
  /* Thumbnails are held the moment they are known, so the grid never waits. */
  state.items.forEach((item) => holdImage(item.image));
  refreshViews();
}

export function inventoryPayload() {
  return {
    type: "inventory",
    items: state.items,
    inventories: state.inventories,
  };
}

/* Host only: the orders land, then the table is told what came of them. */
export function commitOps(ops) {
  const next = applyOps(
    { items: state.items, inventories: state.inventories },
    ops,
    holderNames(),
  );
  setInventory(next.items, next.inventories);
  broadcast(inventoryPayload());
}

/* Administrateur only: whoever holds the room applies it. */
export function publishOps(ops) {
  if (!ops) return false;
  if (network.isHost) {
    commitOps(ops);
    return true;
  }
  return sendUpstream({ type: "inventory-ops", ops });
}

/* Administrateur only: the catalogue was edited here, so the whole thing
   travels rather than a diff. */
function publishState() {
  if (!state.isAdmin) return;
  if (network.isHost) {
    broadcast(inventoryPayload());
    return;
  }
  sendUpstream({
    type: "inventory-state",
    items: state.items,
    inventories: state.inventories,
  });
}

/* ---------------- The player's own grid ---------------- */

export function openInventory() {
  modals.openInventory(selfItems(), pickItem);
}

/* A picked item is a word in the plan, not an action of its own. */
export function pickItem(item) {
  modals.closeInventory();
  const input = dom.turnInput;
  if (!input) return;

  const tag = "[" + item.name + "]";
  const body = input.value;
  const next = !body || /\s$/.test(body) ? body + tag : body + " " + tag;
  input.value = input.maxLength > 0 ? next.slice(0, input.maxLength) : next;
  if (dom.turnError) dom.turnError.textContent = "";
  input.focus();
}

/* ---------------- The administrateur's manager ---------------- */

export function editItem(name) {
  const item = findItem(state.items, name);
  if (!item) return;
  dom.itemKeyInput.value = item.name;
  dom.itemNameInput.value = item.name;
  dom.itemDescInput.value = item.description || "";
  dom.itemImageUrl.value = item.image || "";
  modals.setStagedItemImage(item.image || null);
  modals.paintItemPreview(item.name, item.image);
  dom.itemFormHeading.textContent = "Edit item";
  dom.itemSubmitButton.textContent = "Update item";
  dom.itemCancelButton.hidden = false;
  dom.itemFormError.textContent = "";
  dom.itemNameInput.focus();
}

function renameHeld(from, to) {
  const key = itemKey(from);
  Object.keys(state.inventories).forEach((holder) => {
    const bag = state.inventories[holder];
    Object.keys(bag).forEach((held) => {
      if (itemKey(held) !== key) return;
      const count = bag[held];
      delete bag[held];
      bag[to] = count;
    });
  });
}

export function removeItem(name) {
  const key = itemKey(name);
  state.items = state.items.filter((item) => itemKey(item.name) !== key);
  Object.keys(state.inventories).forEach((holder) => {
    const bag = state.inventories[holder];
    Object.keys(bag).forEach((held) => {
      if (itemKey(held) === key) delete bag[held];
    });
  });
  if (itemKey(dom.itemKeyInput.value) === key) modals.resetItemForm();
  publishState();
  refreshViews();
}

/* Payloads and saves only ever hand over data; the form is the one place an
   item is minted by hand. */
export function submitItemForm() {
  const cleaned = cleanItem({
    name: dom.itemNameInput.value,
    image: modals.getStagedItemImage(),
    description: dom.itemDescInput.value,
  });
  if (!cleaned) {
    dom.itemFormError.textContent = "An item needs a name.";
    return;
  }

  const previous = itemName(dom.itemKeyInput.value);
  const clash = findItem(state.items, cleaned.name);
  if (clash && itemKey(clash.name) !== itemKey(previous)) {
    dom.itemFormError.textContent = "An item by that name already exists.";
    return;
  }

  const existing = previous ? findItem(state.items, previous) : null;
  if (existing) {
    if (itemKey(existing.name) !== itemKey(cleaned.name)) {
      renameHeld(existing.name, cleaned.name);
    }
    existing.name = cleaned.name;
    existing.image = cleaned.image;
    existing.description = cleaned.description;
  } else {
    state.items.push(cleaned);
  }

  holdImage(cleaned.image);
  modals.resetItemForm();
  publishState();
  refreshViews();
}

/* ---------------- Import ---------------- */

/* Every item named in the plans being imported, once each, with what the
   table actually holds of it. Items nobody carries are not usable, so they
   are left out. */
export function usedItemLines(texts) {
  const out = [];
  mentionedNames(texts).forEach((name) => {
    const total = totalHeld(name);
    if (!total) return;
    const known = findItem(state.items, name);
    const label = known ? known.name : name;
    const description =
      known && known.description ? known.description : "No description.";
    out.push(label + " (x" + total + ") — " + description);
  });
  return out;
}
