/* js/dom.js */

/* Every element the app touches, looked up once, plus the anchors that let
   whole regions be detached and put back. */

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
  sendButton: document.getElementById("send-button"),
  composerLock: document.getElementById("composer-lock"),

  turnLog: document.getElementById("turn-builder-log"),
  turnComposer: document.getElementById("turn-composer"),
  turnInput: document.getElementById("turn-input"),
  turnReady: document.getElementById("turn-ready"),
  turnSend: document.getElementById("turn-send"),
  turnError: document.getElementById("turn-error"),
  turnLock: document.getElementById("turn-lock"),

  readyBanner: document.getElementById("ready-banner"),
  importButton: document.getElementById("import-button"),

  stageSide: document.getElementById("stage-side"),
  sceneThumb: document.getElementById("scene-thumb"),

  panelFoot: document.getElementById("panel-foot"),
  healthBar: document.getElementById("health-bar"),
  moraleBar: document.getElementById("morale-bar"),

  psycheButton: document.getElementById("psyche-button"),
  psycheModal: document.getElementById("psyche-modal"),
  psycheClose: document.getElementById("psyche-modal-close"),
  psycheSheet: document.getElementById("psyche-sheet"),

  // The player's own character, written to a file they keep
  sheetExport: document.getElementById("sheet-export"),

  deck: document.getElementById("deck"),
  adminTools: document.getElementById("admin-tools"),
  trackUrl: document.getElementById("track-url"),
  trackPlay: document.getElementById("track-play"),
  trackStop: document.getElementById("track-stop"),
  trackLabel: document.getElementById("track-label"),
  deckError: document.getElementById("deck-error"),
  audioUnlock: document.getElementById("audio-unlock"),

  // Save files — administrateur only
  sessionExport: document.getElementById("session-export"),
  sessionLoad: document.getElementById("session-load"),
  sessionFile: document.getElementById("session-file"),
  sessionNote: document.getElementById("session-note"),

  // Skill-check verdict overlay
  checkOverlay: document.getElementById("check-overlay"),
  checkOverlayScene: document.getElementById("check-overlay-scene"),
  checkDie1: document.getElementById("check-die-1"),
  checkDie2: document.getElementById("check-die-2"),
  checkOverlayTitle: document.getElementById("check-overlay-title"),

  // Experience overlay. xpArt is the plate a new skill point brings with it.
  xpOverlay: document.getElementById("xp-overlay"),
  xpVignette: document.getElementById("xp-vignette"),
  xpArt: document.getElementById("xp-art"),
  xpTitle: document.getElementById("xp-title"),
  xpAmount: document.getElementById("xp-amount"),

  modal: document.getElementById("portrait-modal"),
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

  // Inventory — the player's own pockets
  inventoryButton: document.getElementById("inventory-button"),
  inventoryModal: document.getElementById("inventory-modal"),
  inventoryModalClose: document.getElementById("inventory-modal-close"),
  inventoryGrid: document.getElementById("inventory-grid"),
  inventoryEmpty: document.getElementById("inventory-empty"),
  inventoryLock: document.getElementById("inventory-lock"),
  inventoryTooltip: document.getElementById("inventory-tooltip"),

  // Items — administrateur only
  itemsButton: document.getElementById("items-button"),
  itemsModal: document.getElementById("items-modal"),
  itemsModalClose: document.getElementById("items-modal-close"),
  itemForm: document.getElementById("item-form"),
  itemFormHeading: document.getElementById("item-form-heading"),
  itemKeyInput: document.getElementById("item-key"),
  itemNameInput: document.getElementById("item-name-input"),
  itemDescInput: document.getElementById("item-description-input"),
  itemImageInput: document.getElementById("item-image-input"),
  itemImageUrl: document.getElementById("item-image-url"),
  itemImagePreview: document.getElementById("item-image-preview"),
  itemSubmitButton: document.getElementById("item-submit-button"),
  itemCancelButton: document.getElementById("item-cancel-button"),
  itemFormError: document.getElementById("item-form-error"),
  itemList: document.getElementById("item-list"),
};

export const anchors = {
  deck: document.createComment("deck"),
  adminTools: document.createComment("admin-tools"),
  composer: document.createComment("composer"),
  stageSide: document.createComment("stage-side"),
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

detach(anchors.deck, dom.deck);
detach(anchors.adminTools, dom.adminTools);
detach(anchors.composer, dom.composer);
detach(anchors.stageSide, dom.stageSide);
detach(anchors.turnComposer, dom.turnComposer);
detach(anchors.panelFoot, dom.panelFoot);
detach(anchors.readyBanner, dom.readyBanner);
