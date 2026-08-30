import { dom } from "./dom.js";
import { paintThumb, clearThumb, cleanName, cleanImageUrl, uid } from "./utils.js";
import { refreshVitals } from "./vitals.js";

let modalReturnFocus = null;
let psycheReturnFocus = null;
let npcReturnFocus = null;
let sheetInstance = null;
let stagedNpcPortrait = null;

/* ---------------- Image/Portrait Modal ---------------- */

export function openImage(name, image, role) {
  paintThumb(dom.modalImage, { name, portrait: image });
  dom.modalRole.textContent = role || "";
  dom.modalRole.hidden = !role;

  modalReturnFocus = document.activeElement?.focus
    ? document.activeElement
    : null;
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

/* ---------------- Psyche Modal ---------------- */

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

  psycheReturnFocus = document.activeElement?.focus
    ? document.activeElement
    : null;
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

/* ---------------- NPC Modal ---------------- */

export function cleanNpc(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    name,
    thumbnail: cleanImageUrl(raw.thumbnail),
  };
}

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
  npcReturnFocus = document.activeElement?.focus
    ? document.activeElement
    : null;
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
