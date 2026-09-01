/* The scene image beside the log, and the NPC roster behind it. */

import { dom } from "../dom.js";
import { cleanName, cleanNpc, cleanScene, paintThumb, uid } from "../utils.js";
import * as modals from "../modals.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";

export function renderScene() {
  if (dom.sceneThumb) {
    paintThumb(dom.sceneThumb, {
      portrait: state.sceneOverride || state.scene.image,
    });
  }
}

/* The reader hands over a skill's card art, or null to fall back to the
   administrateur's scene image. */
export function setSceneOverride(url) {
  state.sceneOverride = url || null;
  renderScene();
}

export function applyScene(next) {
  state.scene = cleanScene(next);
  renderScene();
}

export function currentSceneImage() {
  return state.sceneOverride || state.scene.image;
}

export function setNpcs(list) {
  state.npcs = (Array.isArray(list) ? list : []).map(cleanNpc).filter(Boolean);
  modals.renderNpcList(state.npcs, editNpc, removeNpc);
}

export function broadcastNpcs() {
  if (!state.isAdmin) return;
  if (network.isHost) {
    broadcast({ type: "npcs", npcs: state.npcs });
    return;
  }
  sendUpstream({ type: "npc-sync", npcs: state.npcs });
}

export function editNpc(id) {
  const item = state.npcs.find((npc) => npc.id === id);
  if (!item) return;
  dom.npcId.value = item.id;
  dom.npcNameInput.value = item.name;
  dom.npcImageUrl.value = item.thumbnail || "";
  modals.setStagedNpcPortrait(item.thumbnail || null);
  paintThumb(dom.npcPortraitPreview, {
    name: item.name,
    portrait: modals.getStagedNpcPortrait(),
  });
  dom.npcFormHeading.textContent = "Edit NPC";
  dom.npcSubmitButton.textContent = "Update NPC";
  dom.npcCancelButton.hidden = false;
  dom.npcFormError.textContent = "";
  dom.npcNameInput.focus();
}

export function removeNpc(id) {
  state.npcs = state.npcs.filter((npc) => npc.id !== id);
  if (dom.npcId.value === id) modals.resetNpcForm();
  modals.renderNpcList(state.npcs, editNpc, removeNpc);
  broadcastNpcs();
}

/* Saves and payloads only ever hand over data; the form is the one place an
   NPC is minted. */
export function submitNpcForm() {
  const name = cleanName(dom.npcNameInput.value);
  if (!name) {
    dom.npcFormError.textContent = "NPC requires a name.";
    return;
  }
  const targetId = dom.npcId.value;
  if (targetId) {
    const existing = state.npcs.find((npc) => npc.id === targetId);
    if (existing) {
      existing.name = name;
      existing.thumbnail = modals.getStagedNpcPortrait();
    }
  } else {
    state.npcs.push({
      id: uid(),
      name,
      thumbnail: modals.getStagedNpcPortrait(),
    });
  }
  modals.resetNpcForm();
  modals.renderNpcList(state.npcs, editNpc, removeNpc);
  broadcastNpcs();
}
