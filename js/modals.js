/* js/modals.js */

/* The dialogs: enlarged portrait, the skill sheet, the NPC manager, the
   player's inventory and the administrateur's item catalogue. Each one
   remembers what to return focus to on close. */

import { dom } from "./dom.js";
import { paintThumb, clearThumb, cleanName } from "./utils.js";
import { refreshVitals } from "./vitals.js";

let modalReturnFocus = null;
let psycheReturnFocus = null;
let npcReturnFocus = null;
let inventoryReturnFocus = null;
let itemsReturnFocus = null;
let sheetInstance = null;
let stagedNpcPortrait = null;
let stagedItemImage = null;

const TOOLTIP_GAP = 8;

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
  dom.modalClose.focus();
}

export function closePortrait() {
  if (dom.modal.hidden) return;
  dom.modal.hidden = true;
  clearThumb(dom.modalImage);
  if (modalReturnFocus && document.contains(modalReturnFocus)) {
    modalReturnFocus.focus();
  }
  modalReturnFocus = null;
}

/* ---------------- Psyche ---------------- */

export function openPsyche(sheetState, onStateChange) {
  if (!dom.psycheModal.hidden) return;

  if (!sheetInstance && window.DiscoSkillSheet) {
    sheetInstance = new window.DiscoSkillSheet(dom.psycheSheet, {
      editable: false,
      state: sheetState,
      onChange: (next) => {
        onStateChange(next);
        refreshVitals(next, false);
      },
    });
  } else if (sheetInstance) {
    sheetInstance.setState(sheetState, true);
  }

  psycheReturnFocus = activeFocus();
  dom.psycheModal.hidden = false;
  dom.psycheClose.focus();
}

export function closePsyche() {
  if (dom.psycheModal.hidden) return;
  if (sheetInstance) sheetInstance.hideTooltip();
  dom.psycheModal.hidden = true;
  if (psycheReturnFocus && document.contains(psycheReturnFocus)) {
    psycheReturnFocus.focus();
  }
  psycheReturnFocus = null;
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
  dom.npcModalClose.focus();
}

export function closeNpcModal() {
  if (!dom.npcModal || dom.npcModal.hidden) return;
  dom.npcModal.hidden = true;
  resetNpcForm();
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

  tip.dataset.item = item.name;
  tip.setAttribute("aria-hidden", "false");
  tip.classList.add("is-open");
  positionItemTooltip(anchor);
}

window.addEventListener("resize", hideItemTooltip);
window.addEventListener("scroll", hideItemTooltip, true);

/* ---------------- Inventory (player) ---------------- */

export function renderInventoryGrid(list, onPick) {
  if (!dom.inventoryGrid) return;
  const items = Array.isArray(list) ? list : [];
  dom.inventoryGrid.textContent = "";
  if (dom.inventoryEmpty) dom.inventoryEmpty.hidden = items.length > 0;

  items.forEach((item) => {
    const cell = document.createElement("div");
    cell.className = "inv-cell";
    cell.setAttribute("role", "listitem");

    const square = document.createElement("button");
    square.type = "button";
    square.className = "inv-item";
    square.title = item.name;
    square.setAttribute("aria-label", item.name + " — name it in your plan");

    const thumb = document.createElement("span");
    thumb.className = "inv-thumb";
    paintThumb(thumb, { name: item.name, portrait: item.image });
    square.appendChild(thumb);

    if (item.count > 1) {
      const count = document.createElement("span");
      count.className = "inv-count";
      count.textContent = "×" + item.count;
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
  renderInventoryGrid(list, onPick);
  inventoryReturnFocus = activeFocus();
  dom.inventoryModal.hidden = false;
  dom.inventoryModalClose.focus();
}

export function closeInventory() {
  if (!dom.inventoryModal || dom.inventoryModal.hidden) return;
  hideItemTooltip();
  dom.inventoryModal.hidden = true;
  if (inventoryReturnFocus && document.contains(inventoryReturnFocus)) {
    inventoryReturnFocus.focus();
  }
  inventoryReturnFocus = null;
}

/* ---------------- Items (administrateur) ---------------- */

export function paintItemPreview(name, image) {
  paintThumb(dom.itemImagePreview, {
    name: String(name == null ? "" : name).trim(),
    portrait: image || null,
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
    const row = document.createElement("div");
    row.className = "npc-item";

    const thumb = document.createElement("div");
    thumb.className = "inv-thumb inv-thumb-sm";
    paintThumb(thumb, { name: item.name, portrait: item.image });

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

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => onRemove(item.name));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

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
  dom.itemsModalClose.focus();
}

export function closeItemsModal() {
  if (!dom.itemsModal || dom.itemsModal.hidden) return;
  dom.itemsModal.hidden = true;
  resetItemForm();
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

export { cleanName };
