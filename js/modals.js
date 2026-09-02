/* js/modals.js */

/* The dialogs: enlarged portrait, the skill sheet, the NPC manager, the
   player's inventory, their goals and the administrateur's item catalogue.
   Each one remembers what to return focus to on close, and is heard opening
   and closing: whichever dialog it was, throwing it open and dismissing it
   each sound the same, because the answer to the player is the same.

   The skill sheet is the one dialog with a life of its own: it is built once
   and kept, so its header has to be told separately when the player's
   experience moves while it is open. It also keeps whichever card was
   selected, tooltip and all, which is why the dialog is put on screen before
   the sheet renders — a tooltip measured against a hidden dialog has no box
   to hang off and would land in the corner of the viewport.

   The sheet is also not ours — it is stats/disco-skills.js — so the two
   sounds it owes are taken from either side of it: a point spent answers
   through onSpend, and a card picked up is heard by listening on its
   container.

   The purse is the one square that is not like the others. It is always the
   first, it prints its amount at one and at none — an empty purse is a
   reading, not an absence — and it wears its sign rather than an initial,
   because money has no portrait. It is also the one item the administrateur
   cannot delete, so it is not offered the button. */

import { dom } from "./dom.js";
import { paintThumb, clearThumb, cleanName } from "./utils.js";
import { isCurrency, CURRENCY_MARK } from "./inventory/items.js";
import { refreshVitals } from "./vitals.js";
import * as sfx from "./audio/sfx.js";

let modalReturnFocus = null;
let psycheReturnFocus = null;
let npcReturnFocus = null;
let inventoryReturnFocus = null;
let itemsReturnFocus = null;
let goalsReturnFocus = null;
let sheetInstance = null;
let stagedNpcPortrait = null;
let stagedItemImage = null;

/* Set on every open, so the sheet built on the first one still calls into
   whatever the app wants today. */
let psycheHandlers = { onChange: null, onSpend: null };

const TOOLTIP_GAP = 8;

/* What counts as a skill card being picked up. The sheet is somebody else's
   markup, so this is written wide enough to catch any of the shapes a card
   can take and narrow enough that the bare background between them stays
   quiet. */
const SKILL_TARGET = [
  "[data-skill]",
  "[data-skill-id]",
  "[data-skill-key]",
  "[data-id]",
  ".skill",
  ".skill-card",
  ".skill-cell",
  ".disco-skill",
  ".disco-skill-card",
  "button",
  "[role='button']",
  "[tabindex]",
].join(", ");

/* A spend and the click that asked for it are the same press. The pick is
   held back a tick and dropped if a spend was asked for in the same breath,
   so the two are never heard at once — whichever of the two handlers the
   sheet runs first. */
const SPEND_WINDOW_MS = 200;
let spendAskedAt = 0;
let sheetWired = false;

function activeFocus() {
  return document.activeElement?.focus ? document.activeElement : null;
}

/* ---------------- Portrait ---------------- */

export function openImage(name, image, role) {
  paintThumb(dom.modalImage, { name, portrait: image });
  if (dom.modalName) dom.modalName.textContent = name || "—";
  dom.modalRole.textContent = role || "";
  dom.modalRole.hidden = !role;

  modalReturnFocus = activeFocus();
  dom.modal.hidden = false;
  sfx.playModal();
  dom.modalClose.focus();
}

export function closePortrait() {
  if (dom.modal.hidden) return;
  dom.modal.hidden = true;
  clearThumb(dom.modalImage);
  sfx.playCancel();
  if (modalReturnFocus && document.contains(modalReturnFocus)) {
    modalReturnFocus.focus();
  }
  modalReturnFocus = null;
}

/* ---------------- Psyche ---------------- */

/* A card taken up in the sheet. Deferred by a tick on purpose: see
   SPEND_WINDOW_MS above. */
function skillPicked(event) {
  const target = event.target;
  if (!target || typeof target.closest !== "function") return;
  if (!target.closest(SKILL_TARGET)) return;
  setTimeout(() => {
    if (Date.now() - spendAskedAt < SPEND_WINDOW_MS) return;
    sfx.playSkillPick();
  }, 0);
}

/* options: { ledger, onChange, onSpend }.

   onSpend is asked before a pip moves and answers whether the point was
   really there to spend — the sheet holds no ledger of its own. The levelling
   cue rides on that answer, so a spend the ledger refused is silent.

   The dialog is unhidden first and on purpose: the sheet restores the card
   the player last had selected, and its tooltip can only place itself against
   a card that has a box. Rendering into a hidden dialog is what used to park
   that tooltip in the top left corner. */
export function openPsyche(sheetState, options) {
  if (!dom.psycheModal.hidden) return;
  const opts = options || {};
  psycheHandlers = {
    onChange: opts.onChange || null,
    onSpend: opts.onSpend || null,
  };

  psycheReturnFocus = activeFocus();
  dom.psycheModal.hidden = false;
  sfx.playModal();

  /* Once, on the container rather than the cards: the sheet rebuilds those
     whenever a point lands. */
  if (!sheetWired && dom.psycheSheet) {
    dom.psycheSheet.addEventListener("click", skillPicked);
    sheetWired = true;
  }

  if (!sheetInstance && window.DiscoSkillSheet) {
    sheetInstance = new window.DiscoSkillSheet(dom.psycheSheet, {
      /* Attributes are the character's, fixed at the door. Points earned in
         play are not, which is what upgradable turns on. */
      editable: false,
      upgradable: true,
      state: sheetState,
      ledger: opts.ledger || null,
      onChange: (next) => {
        if (psycheHandlers.onChange) psycheHandlers.onChange(next);
        refreshVitals(next, false);
      },
      onSpend: (skillId) => {
        spendAskedAt = Date.now();
        const allowed = psycheHandlers.onSpend
          ? psycheHandlers.onSpend(skillId)
          : false;
        if (allowed) sfx.playSkillLevel();
        return allowed;
      },
    });
  } else if (sheetInstance) {
    sheetInstance.setState(sheetState, true);
    sheetInstance.setLedger(opts.ledger || null);
  }

  /* Measured again now that the cards are laid out, in case a render happened
     on the frame the dialog was still coming up. */
  if (sheetInstance && sheetInstance.refreshTooltip) {
    sheetInstance.refreshTooltip();
  }

  dom.psycheClose.focus();
}

export function closePsyche() {
  if (dom.psycheModal.hidden) return;
  if (sheetInstance) sheetInstance.hideTooltip();
  dom.psycheModal.hidden = true;
  sfx.playCancel();
  if (psycheReturnFocus && document.contains(psycheReturnFocus)) {
    psycheReturnFocus.focus();
  }
  psycheReturnFocus = null;
}

/* Experience earned while the sheet is open, or a spend just authorised. Only
   the header repaints, so a selected card and its tooltip stay put. */
export function refreshPsycheLedger(ledger) {
  if (sheetInstance && sheetInstance.setLedger) sheetInstance.setLedger(ledger);
}

export function getSheetInstance() {
  return sheetInstance;
}

/* ---------------- NPCs ---------------- */

export function resetNpcForm() {
  if (!dom.npcForm) return;
  dom.npcId.value = "";
  dom.npcNameInput.value = "";
  dom.npcImageUrl.value = "";
  dom.npcImageInput.value = "";
  stagedNpcPortrait = null;
  paintThumb(dom.npcPortraitPreview, { name: "", portrait: null });
  dom.npcFormHeading.textContent = "Add NPC";
  dom.npcSubmitButton.textContent = "Save NPC";
  dom.npcCancelButton.hidden = true;
  dom.npcFormError.textContent = "";
}

export function renderNpcList(npcs, onEdit, onRemove) {
  if (!dom.npcList) return;
  dom.npcList.textContent = "";
  if (!npcs.length) {
    const empty = document.createElement("p");
    empty.className = "npc-empty";
    empty.textContent = "No NPCs created yet.";
    dom.npcList.appendChild(empty);
    return;
  }

  npcs.forEach((npc) => {
    const row = document.createElement("div");
    row.className = "npc-item";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    paintThumb(thumb, { name: npc.name, portrait: npc.thumbnail });

    const name = document.createElement("span");
    name.className = "npc-item-name";
    name.textContent = npc.name;

    const actions = document.createElement("div");
    actions.className = "npc-item-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => onEdit(npc.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => onRemove(npc.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(thumb);
    row.appendChild(name);
    row.appendChild(actions);

    dom.npcList.appendChild(row);
  });
}

export function openNpcModal(isAdmin, npcs, onEdit, onRemove) {
  if (!isAdmin || !dom.npcModal) return;
  resetNpcForm();
  renderNpcList(npcs, onEdit, onRemove);
  npcReturnFocus = activeFocus();
  dom.npcModal.hidden = false;
  sfx.playModal();
  dom.npcModalClose.focus();
}

export function closeNpcModal() {
  if (!dom.npcModal || dom.npcModal.hidden) return;
  dom.npcModal.hidden = true;
  resetNpcForm();
  sfx.playCancel();
  if (npcReturnFocus && document.contains(npcReturnFocus)) {
    npcReturnFocus.focus();
  }
  npcReturnFocus = null;
}

export function getStagedNpcPortrait() {
  return stagedNpcPortrait;
}

export function setStagedNpcPortrait(url) {
  stagedNpcPortrait = url;
}

/* ---------------- Item squares ---------------- */

/* One square's face. A picture if the item has one, its sign if it is money,
   its initial otherwise. clearThumb is what drops any portrait custom
   property left over from a previous render. */
function paintItemSquare(element, item) {
  if (!element) return;
  const held = item || {};

  element.classList.remove("is-sign");

  if (held.image) {
    paintThumb(element, { name: held.name, portrait: held.image });
    return;
  }
  if (held.mark) {
    clearThumb(element);
    element.setAttribute("data-mark", "sign");
    element.classList.add("is-sign");
    element.textContent = held.mark;
    return;
  }
  paintThumb(element, { name: held.name || "", portrait: null });
}

/* ---------------- Item tooltip ---------------- */

/* Same shape as the skill sheet's: fixed, hung off whatever was pressed, and
   dropped the moment the page moves under it. */
function hideItemTooltip() {
  const tip = dom.inventoryTooltip;
  if (!tip) return;
  tip.classList.remove("is-open");
  tip.setAttribute("aria-hidden", "true");
  tip.textContent = "";
  delete tip.dataset.item;
}

function positionItemTooltip(anchor) {
  const tip = dom.inventoryTooltip;
  const from = anchor.getBoundingClientRect();
  const box = tip.getBoundingClientRect();

  const maxLeft = Math.max(
    TOOLTIP_GAP,
    window.innerWidth - box.width - TOOLTIP_GAP,
  );
  let left = from.left + from.width / 2 - box.width / 2;
  left = Math.min(Math.max(left, TOOLTIP_GAP), maxLeft);

  let top = from.bottom + TOOLTIP_GAP;
  if (top + box.height > window.innerHeight - TOOLTIP_GAP) {
    top = from.top - box.height - TOOLTIP_GAP;
  }
  if (top < TOOLTIP_GAP) top = TOOLTIP_GAP;

  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
}

function toggleItemTooltip(anchor, item) {
  const tip = dom.inventoryTooltip;
  if (!tip) return;
  if (tip.classList.contains("is-open") && tip.dataset.item === item.name) {
    hideItemTooltip();
    return;
  }

  tip.textContent = "";
  const title = document.createElement("p");
  title.className = "inv-tooltip-title";
  title.textContent = item.name;
  const body = document.createElement("p");
  body.className = "inv-tooltip-text";
  body.textContent = item.description || "Nothing is written about it.";
  tip.appendChild(title);
  tip.appendChild(body);

  /* A purse says what is in it, since its square carries a number rather than
     a count of things. */
  if (item.currency) {
    const purse = document.createElement("p");
    purse.className = "inv-tooltip-text inv-tooltip-purse";
    purse.textContent = "You currently have " + (item.count || 0) + ".";
    tip.appendChild(purse);
  }

  tip.dataset.item = item.name;
  tip.setAttribute("aria-hidden", "false");
  tip.classList.add("is-open");
  positionItemTooltip(anchor);
}

/* ---------------- Inventory (player) ---------------- */

/* Why a pick did nothing — the composer being locked, usually. Cleared on
   every open, so a stale reason cannot outlive the round it belonged to. */
export function noteInventory(text) {
  if (!dom.inventoryLock) return;
  const body = text || "";
  dom.inventoryLock.textContent = body;
  dom.inventoryLock.hidden = !body;
}

/* Money is always there, so "empty" has to mean something narrower than it
   used to: nothing but the purse. What the purse holds decides which of the
   two readings is true. */
function paintInventoryEmpty(items) {
  if (!dom.inventoryEmpty) return;
  let things = 0;
  let money = 0;
  items.forEach((item) => {
    if (item.currency) money = item.count || 0;
    else things += 1;
  });

  if (things) {
    dom.inventoryEmpty.hidden = true;
    return;
  }
  dom.inventoryEmpty.hidden = false;
  dom.inventoryEmpty.textContent = money
    ? "Nothing but your money."
    : "Your pockets are empty.";
}

export function renderInventoryGrid(list, onPick) {
  if (!dom.inventoryGrid) return;
  const items = Array.isArray(list) ? list : [];
  dom.inventoryGrid.textContent = "";
  paintInventoryEmpty(items);

  items.forEach((item) => {
    const cell = document.createElement("div");
    cell.className = "inv-cell";
    cell.setAttribute("role", "listitem");

    const square = document.createElement("button");
    square.type = "button";
    square.className = "inv-item";
    if (item.currency) square.classList.add("inv-currency");
    square.title = item.name;
    square.setAttribute(
      "aria-label",
      item.currency
        ? item.name + " — " + (item.count || 0) + ", name it in your plan"
        : item.name + " — name it in your plan",
    );

    const thumb = document.createElement("span");
    thumb.className = "inv-thumb";
    paintItemSquare(thumb, item);
    square.appendChild(thumb);

    /* A purse prints its amount at one and at none: how much money there is
       is the whole of what the square says. */
    if (item.currency || item.count > 1) {
      const count = document.createElement("span");
      count.className = "inv-count";
      if (item.currency) {
        count.classList.add("inv-count-currency");
        count.textContent = String(item.count || 0);
      } else {
        count.textContent = "×" + item.count;
      }
      square.appendChild(count);
    }

    const name = document.createElement("span");
    name.className = "inv-name";
    name.textContent = item.name;
    square.appendChild(name);

    square.addEventListener("click", () => onPick(item));
    cell.appendChild(square);

    const info = document.createElement("button");
    info.type = "button";
    info.className = "inv-info";
    info.textContent = "i";
    info.title = "What is this?";
    info.setAttribute("aria-label", "About " + item.name);
    info.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleItemTooltip(info, item);
    });
    cell.appendChild(info);

    dom.inventoryGrid.appendChild(cell);
  });
}

export function openInventory(list, onPick) {
  if (!dom.inventoryModal) return;
  noteInventory("");
  renderInventoryGrid(list, onPick);
  inventoryReturnFocus = activeFocus();
  dom.inventoryModal.hidden = false;
  sfx.playModal();
  dom.inventoryModalClose.focus();
}

export function closeInventory() {
  if (!dom.inventoryModal || dom.inventoryModal.hidden) return;
  hideItemTooltip();
  noteInventory("");
  dom.inventoryModal.hidden = true;
  sfx.playCancel();
  if (inventoryReturnFocus && document.contains(inventoryReturnFocus)) {
    inventoryReturnFocus.focus();
  }
  inventoryReturnFocus = null;
}

/* ---------------- Goals (player) ---------------- */

/* Read only: a goal is written by the administrateur's payload, so the
   dashboard has nothing to press but the way out. */
export function renderGoalsList(list) {
  if (!dom.goalsList) return;
  const goals = Array.isArray(list) ? list : [];
  dom.goalsList.textContent = "";
  if (dom.goalsEmpty) dom.goalsEmpty.hidden = goals.length > 0;

  goals.forEach((goal) => {
    const card = document.createElement("article");
    card.className = "goal-card";
    card.setAttribute("role", "listitem");
    if (goal.done) card.classList.add("is-done");

    const head = document.createElement("div");
    head.className = "goal-head";

    const name = document.createElement("h3");
    name.className = "goal-name";
    name.textContent = goal.name;
    head.appendChild(name);

    /* What completion pays, printed done or not: the reward is part of what
       the goal says. */
    const paid = document.createElement("span");
    paid.className = "goal-reward";
    paid.textContent = goal.xp ? "+" + goal.xp + " XP" : "No reward";
    head.appendChild(paid);
    card.appendChild(head);

    const text = document.createElement("p");
    text.className = "goal-text";
    text.textContent = goal.description || "Nothing is written about it.";
    card.appendChild(text);

    const mark = document.createElement("p");
    mark.className = "goal-state";
    mark.textContent = goal.done ? "Completed" : "In progress";
    card.appendChild(mark);

    dom.goalsList.appendChild(card);
  });
}

export function openGoals(list) {
  if (!dom.goalsModal) return;
  renderGoalsList(list);
  goalsReturnFocus = activeFocus();
  dom.goalsModal.hidden = false;
  sfx.playModal();
  dom.goalsModalClose.focus();
}

export function closeGoals() {
  if (!dom.goalsModal || dom.goalsModal.hidden) return;
  dom.goalsModal.hidden = true;
  sfx.playCancel();
  if (goalsReturnFocus && document.contains(goalsReturnFocus)) {
    goalsReturnFocus.focus();
  }
  goalsReturnFocus = null;
}

/* A book that moved while the dashboard was open. */
export function refreshGoals(list) {
  if (!dom.goalsModal || dom.goalsModal.hidden) return;
  renderGoalsList(list);
}

/* ---------------- Items (administrateur) ---------------- */

export function paintItemPreview(name, image) {
  const label = String(name == null ? "" : name).trim();
  paintItemSquare(dom.itemImagePreview, {
    name: label,
    image: image || null,
    mark: isCurrency(label) ? CURRENCY_MARK : "",
  });
}

export function resetItemForm() {
  if (!dom.itemForm) return;
  dom.itemKeyInput.value = "";
  dom.itemNameInput.value = "";
  dom.itemDescInput.value = "";
  dom.itemImageUrl.value = "";
  dom.itemImageInput.value = "";
  stagedItemImage = null;
  paintItemPreview("", null);
  dom.itemFormHeading.textContent = "Add item";
  dom.itemSubmitButton.textContent = "Save item";
  dom.itemCancelButton.hidden = true;
  dom.itemFormError.textContent = "";
}

export function renderItemList(list, onEdit, onRemove) {
  if (!dom.itemList) return;
  const items = Array.isArray(list) ? list : [];
  dom.itemList.textContent = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "npc-empty";
    empty.textContent = "No items in play yet.";
    dom.itemList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const money = isCurrency(item.name);

    const row = document.createElement("div");
    row.className = "npc-item";
    if (money) row.classList.add("item-fixed");

    const thumb = document.createElement("div");
    thumb.className = "inv-thumb inv-thumb-sm";
    paintItemSquare(thumb, {
      name: item.name,
      image: item.image,
      mark: money ? CURRENCY_MARK : "",
    });

    const name = document.createElement("span");
    name.className = "npc-item-name";
    name.textContent = item.name;
    name.title = item.description || item.name;

    const actions = document.createElement("div");
    actions.className = "npc-item-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => onEdit(item.name));
    actions.appendChild(editBtn);

    /* The money is not the administrateur's to withdraw, so the button that
       would try is simply not there — a disabled one only invites the
       question. */
    if (money) {
      const held = document.createElement("span");
      held.className = "item-fixed-note";
      held.textContent = "Money";
      held.title =
        "Every character carries this. It cannot be renamed or removed.";
      actions.appendChild(held);
    } else {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => onRemove(item.name));
      actions.appendChild(delBtn);
    }

    row.appendChild(thumb);
    row.appendChild(name);
    row.appendChild(actions);

    dom.itemList.appendChild(row);
  });
}

export function openItemsModal(isAdmin, list, onEdit, onRemove) {
  if (!isAdmin || !dom.itemsModal) return;
  resetItemForm();
  renderItemList(list, onEdit, onRemove);
  itemsReturnFocus = activeFocus();
  dom.itemsModal.hidden = false;
  sfx.playModal();
  dom.itemsModalClose.focus();
}

export function closeItemsModal() {
  if (!dom.itemsModal || dom.itemsModal.hidden) return;
  dom.itemsModal.hidden = true;
  resetItemForm();
  sfx.playCancel();
  if (itemsReturnFocus && document.contains(itemsReturnFocus)) {
    itemsReturnFocus.focus();
  }
  itemsReturnFocus = null;
}

export function getStagedItemImage() {
  return stagedItemImage;
}

export function setStagedItemImage(url) {
  stagedItemImage = url;
}

window.addEventListener("resize", hideItemTooltip);
window.addEventListener("scroll", hideItemTooltip, true);

export { cleanName };
