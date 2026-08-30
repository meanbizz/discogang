export const dom = {
  joinPanel: document.getElementById("join-panel"),
  joinForm: document.getElementById("join-form"),
  joinButton: document.getElementById("join-button"),
  nameInput: document.getElementById("name-input"),
  portraitInput: document.getElementById("portrait-input"),
  portraitUrl: document.getElementById("portrait-url"),
  portraitPreview: document.getElementById("portrait-preview"),
  statsInput: document.getElementById("stats-input"),
  joinError: document.getElementById("join-error"),

  sessionPanel: document.getElementById("session-panel"),
  roleLabel: document.getElementById("role-label"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  leaveButton: document.getElementById("leave-button"),

  roster: document.getElementById("roster"),
  log: document.getElementById("log"),
  composer: document.getElementById("composer"),
  textInput: document.getElementById("text-input"),

  turnLog: document.getElementById("turn-builder-log"),
  turnComposer: document.getElementById("turn-composer"),
  turnInput: document.getElementById("turn-input"),
  turnReady: document.getElementById("turn-ready"),
  turnError: document.getElementById("turn-error"),

  readyBanner: document.getElementById("ready-banner"),
  importButton: document.getElementById("import-button"),

  sceneThumb: document.getElementById("scene-thumb"),
  sceneTools: document.getElementById("scene-tools"),
  sceneImageInput: document.getElementById("scene-image-input"),
  sceneImageUrl: document.getElementById("scene-image-url"),
  sceneError: document.getElementById("scene-error"),

  panelFoot: document.getElementById("panel-foot"),
  healthBar: document.getElementById("health-bar"),
  moraleBar: document.getElementById("morale-bar"),

  psycheButton: document.getElementById("psyche-button"),
  psycheModal: document.getElementById("psyche-modal"),
  psycheClose: document.getElementById("psyche-modal-close"),
  psycheSheet: document.getElementById("psyche-sheet"),

  deck: document.getElementById("deck"),
  adminTools: document.getElementById("admin-tools"),
  trackUrl: document.getElementById("track-url"),
  trackPlay: document.getElementById("track-play"),
  trackStop: document.getElementById("track-stop"),
  trackLabel: document.getElementById("track-label"),
  deckError: document.getElementById("deck-error"),
  audioUnlock: document.getElementById("audio-unlock"),

  modal: document.getElementById("portrait-modal"),
  modalCard: document.querySelector("#portrait-modal .modal-card"),
  modalClose: document.getElementById("portrait-modal-close"),
  modalImage: document.getElementById("portrait-modal-image"),
  modalName: document.getElementById("portrait-modal-name"),
  modalRole: document.getElementById("portrait-modal-role"),

  npcButton: document.getElementById("npc-button"),
  npcModal: document.getElementById("npc-modal"),
  npcModalClose: document.getElementById("npc-modal-close"),
  npcForm: document.getElementById("npc-form"),
  npcFormHeading: document.getElementById("npc-form-heading"),
  npcId: document.getElementById("npc-id"),
  npcNameInput: document.getElementById("npc-name-input"),
  npcImageInput: document.getElementById("npc-image-input"),
  npcImageUrl: document.getElementById("npc-image-url"),
  npcPortraitPreview: document.getElementById("npc-portrait-preview"),
  npcSubmitButton: document.getElementById("npc-submit-button"),
  npcCancelButton: document.getElementById("npc-cancel-button"),
  npcFormError: document.getElementById("npc-form-error"),
  npcList: document.getElementById("npc-list"),
};

// Anchors for dynamic detachment/reattachment
export const anchors = {
  deck: document.createComment("deck"),
  adminTools: document.createComment("admin-tools"),
  composer: document.createComment("composer"),
  sceneTools: document.createComment("scene-tools"),
  turnComposer: document.createComment("turn-composer"),
  panelFoot: document.createComment("panel-foot"),
  readyBanner: document.createComment("ready-banner"),
};

export function detach(anchor, node) {
  if (node && node.parentNode) {
    node.parentNode.insertBefore(anchor, node);
    node.remove();
  }
}

export function setPresent(anchor, node, present) {
  if (!node) return;
  if (present) {
    if (!node.isConnected && anchor.parentNode) {
      anchor.parentNode.insertBefore(node, anchor.nextSibling);
    }
    node.hidden = false;
    return;
  }
  node.hidden = true;
  if (node.isConnected) node.remove();
}

// Initial detachments for conditional rendering
detach(anchors.deck, dom.deck);
detach(anchors.adminTools, dom.adminTools);
detach(anchors.composer, dom.composer);
detach(anchors.sceneTools, dom.sceneTools);
detach(anchors.turnComposer, dom.turnComposer);
detach(anchors.panelFoot, dom.panelFoot);
detach(anchors.readyBanner, dom.readyBanner);
