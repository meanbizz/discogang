/* The scene image beside the log, and the NPC roster behind it. */

import { dom } from "../dom.js";
import { cleanName, cleanNpc, cleanScene, paintThumb, uid } from "../utils.js";
import { normalizeKey } from "../dialogue/text.js";
import * as modals from "../modals.js";
import { state } from "./state.js";
import { network, broadcast, sendUpstream } from "./net.js";

export function renderScene() {
  const face = currentSceneImage();
  if (!dom.sceneThumb) return;
  /* No face to show, no box. The column itself stays, so the log neither
     reflows nor rescales its paper mid-scene. */
  dom.sceneThumb.hidden = !face;
  paintThumb(dom.sceneThumb, { portrait: face });
}

/* An NPC the administrateur actually minted, matched by name. */
function npcPortrait(speaker) {
  const wanted = normalizeKey(speaker);
  if (!wanted) return null;
  const found = (state.npcs || []).find(
    (npc) => normalizeKey(npc.name) === wanted,
  );
  return (found && found.thumbnail) || null;
}

/* The reader hands over a skill's card art and who spoke it: a minted NPC
   lends their own face, the narrator and names nobody wrote lend none. */
export function setSceneOverride(url, speaker) {
  state.sceneOverride = url || npcPortrait(speaker);
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
