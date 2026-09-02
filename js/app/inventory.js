/* js/app/inventory.js */

/* Items from the app's side: what each character holds, the catalogue of
   everything in play, and the payload orders that move items around.

   The host is the only seat that mutates any of it; everybody else is told.

   Money is watched rather than moved: every live change to the table's items
   is compared against what this seat's purse held a moment ago, and a
   difference is announced. Only live changes — a welcome, a reconnect and a
   restored save all land silently, since money that was already earned is not
   news, and a seat coming back from a dropped wire should not be paid twice
   in its own eyes. */

import { dom } from "../dom.js";
import { holdImage } from "../assets.js";
import * as modals from "../modals.js";
import * as overlays from "../overlays.js";
import {
  applyOps,
  cleanItem,
  cleanItems,
  cleanInventories,
  findItem,
  isCurrency,
  itemKey,
  itemName,
  mentionedNames,
  CURRENCY_MARK,
  CURRENCY_NAME,
} from "../inventory/items.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";
import { planningUnlocked } from "./locks.js";

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

/* One square, described from the catalogue. currency and mark are what let
   the grid treat a purse as a purse: it prints its amount at one and at none,
   and it wears its sign instead of an initial. */
function describeHeld(name, count) {
  const known = findItem(state.items, name);
  const currency = isCurrency(name);
  return {
    name: known ? known.name : itemName(name),
    image: known ? known.image : null,
    description: known ? known.description : "",
    count,
    currency,
    mark: currency ? CURRENCY_MARK : "",
  };
}

/* What one character carries, described from the catalogue. The purse is
   always the first square and is there at nothing: a bag holds no zeroes, so
   an empty purse is read from the catalogue rather than found in the bag. */
export function heldBy(holder) {
  const bag = bagOf(holder) || {};
  const out = [];
  let money = 0;

  Object.keys(bag).forEach((name) => {
    const count = bag[name];
    if (isCurrency(name)) {
      money = Number(count) || 0;
      return;
    }
    if (!count) return;
    out.push(describeHeld(name, count));
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  out.unshift(describeHeld(CURRENCY_NAME, money));
  return out;
}

export function selfItems() {
  return heldBy(state.profile.name);
}

/* Just the number, for the before-and-after either side of a change. */
export function moneyHeld(holder) {
  const bag = bagOf(holder);
  if (!bag) return 0;
  const names = Object.keys(bag);
  for (let i = 0; i < names.length; i += 1) {
    if (isCurrency(names[i])) return Number(bag[names[i]]) || 0;
  }
  return 0;
}

function selfMoney() {
  return moneyHeld(state.profile.name);
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

/* The administrateur keeps no purse, so nothing is announced to them. */
function announceMoney(before, after) {
  if (state.isAdmin) return;
  overlays.money(after - before);
}

/* announce is for the live paths only: the host committing a payload's orders,
   and a guest being told what came of them. */
export function setInventory(rawItems, rawInventories, announce) {
  const before = announce ? selfMoney() : 0;

  state.items = cleanItems(rawItems);
  state.inventories = cleanInventories(rawInventories);
  /* Thumbnails are held the moment they are known, so the grid never waits. */
  state.items.forEach((item) => holdImage(item.image));
  refreshViews();

  if (announce) announceMoney(before, selfMoney());
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
  setInventory(next.items, next.inventories, true);
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

/* A picked item is a word in the plan, not an action of its own — so there
   has to be a plan to write it into. While the scene is still playing out the
   composer is locked, and the grid says why rather than dropping a name into
   a field nobody can send. Reading what an item is stays available either
   way. */
export function pickItem(item) {
  const input = dom.turnInput;
  if (!input) return;

  if (!planningUnlocked()) {
    modals.noteInventory(
      "The scene is still playing out — items are named in a plan, and there is none to write yet.",
    );
    return;
  }

  modals.closeInventory();

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

/* The money is not the administrateur's to withdraw: every character carries
   it, and a catalogue without it is put back the moment anything is read.
   Refusing here is what keeps the two from disagreeing in the meantime. */
export function removeItem(name) {
  if (isCurrency(name)) {
    dom.itemFormError.textContent =
      CURRENCY_NAME + " is the table's money — it cannot be taken out of play.";
    return;
  }

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

  /* Its description and its picture are the administrateur's; its name is
     not. Everything that moves money looks it up by that name. */
  if (previous && isCurrency(previous) && !isCurrency(cleaned.name)) {
    dom.itemFormError.textContent =
      CURRENCY_NAME + " cannot be renamed — it is the table's money.";
    return;
  }

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
