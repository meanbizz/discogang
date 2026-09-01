/* js/app/events.js */

/* Every listener the session panel needs, in one place. Each one only calls
   into the modules above — no logic lives here. */

import { dom } from "../dom.js";
import { cleanImageUrl, cleanName, paintThumb } from "../utils.js";
import { probeImage, rejectImageFile, uploadImage } from "../upload.js";
import * as modals from "../modals.js";
import * as music from "../audio/music.js";
import * as dialogue from "../dialogue/dialogue.js";
import { readFile } from "../export/file.js";
import { state } from "./state.js";
import { network } from "./net.js";
import { exportTurns, setSelfReady, shareText, shareTurn } from "./actions.js";
import { exportSession, loadSession, noteSession } from "./save.js";
import { loadAllowed, refreshLoadButton } from "./locks.js";
import {
  broadcastNpcs,
  currentSceneImage,
  editNpc,
  removeNpc,
  submitNpcForm,
} from "./scene.js";
import { leave } from "./room.js";

/* Enter sends; Shift+Enter is a new line. requestSubmit keeps the form's own
   handler as the single path. */
function submitOnEnter(event, form, fallback) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  if (form.requestSubmit) form.requestSubmit();
  else fallback();
}

function bindComposers() {
  dom.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    shareText(dom.textInput.value);
    dom.textInput.value = "";
    dom.textInput.focus();
  });

  dom.textInput.addEventListener("keydown", (event) => {
    submitOnEnter(event, dom.composer, () => {
      shareText(dom.textInput.value);
      dom.textInput.value = "";
    });
  });

  dom.turnComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (shareTurn(dom.turnInput.value)) dom.turnInput.value = "";
    dom.turnInput.focus();
  });

  dom.turnInput.addEventListener("input", () => {
    dom.turnError.textContent = "";
  });

  dom.turnInput.addEventListener("keydown", (event) => {
    submitOnEnter(event, dom.turnComposer, () => {
      if (shareTurn(dom.turnInput.value)) dom.turnInput.value = "";
    });
  });

  dom.turnReady.addEventListener("click", () => setSelfReady(!state.selfReady));
  dom.importButton.addEventListener("click", exportTurns);
}

/* The file input is hidden; Load is what the administrateur presses, and
   loadAllowed decides whether the picker opens at all. */
function bindSaveFiles() {
  if (dom.sessionExport) {
    dom.sessionExport.addEventListener("click", exportSession);
  }
  if (!dom.sessionLoad || !dom.sessionFile) return;

  dom.sessionLoad.addEventListener("click", () => {
    if (!loadAllowed()) {
      refreshLoadButton();
      noteSession("A save only loads into an untouched room.");
      return;
    }
    /* Clearing the value first is what lets the same file be picked twice. */
    dom.sessionFile.value = "";
    dom.sessionFile.click();
  });

  dom.sessionFile.addEventListener("change", () => {
    const file = dom.sessionFile.files?.[0];
    if (!file) return;
    noteSession("Reading that save…");
    readFile(file, (snap, error) => {
      dom.sessionFile.value = "";
      if (error) {
        noteSession(error);
        return;
      }
      loadSession(snap);
    });
  });
}

function bindDeck() {
  if (dom.trackPlay) {
    dom.trackPlay.addEventListener("click", () => {
      dom.deckError.textContent = "";
      const videoId = music.parseVideoId(dom.trackUrl.value);
      if (!videoId) {
        dom.deckError.textContent = "That does not look like a YouTube link.";
        return;
      }
      music.markAudioUnlocked();
      const track = { videoId, startedAt: Date.now() };
      if (network.isHost) {
        music.applyTrack(track);
        network.broadcast({ type: "track", track });
      } else if (network.upstream?.open) {
        network.upstream.send({ type: "track-request", track });
      }
      dom.trackUrl.value = "";
    });
  }

  if (dom.trackStop) {
    dom.trackStop.addEventListener("click", () => {
      dom.deckError.textContent = "";
      if (network.isHost) {
        music.applyTrack(null);
        network.broadcast({ type: "track", track: null });
      } else if (network.upstream?.open) {
        network.upstream.send({ type: "track-request", track: null });
      }
    });
  }

  /* Any seat can be blocked from autoplaying, so this button lives in the
     session bar rather than in the administrateur's deck. */
  if (dom.audioUnlock) {
    dom.audioUnlock.addEventListener("click", () => {
      music.markAudioUnlocked();
      music.resync();
    });
  }

  /* Autoplay stays blocked until the page has been touched once. */
  document.addEventListener("pointerdown", music.markAudioUnlocked, {
    capture: true,
    once: true,
  });
  document.addEventListener("keydown", music.markAudioUnlocked, {
    capture: true,
    once: true,
  });
}

function bindModals() {
  if (dom.sceneThumb) {
    dom.sceneThumb.addEventListener("click", () =>
      modals.openImage("Scene", currentSceneImage(), ""),
    );
  }

  dom.roster.addEventListener("click", (event) => {
    const target = event.target.closest(".roster-person");
    if (!target?.dataset.personId) return;
    const person = state.roster.get(target.dataset.personId);
    if (!person) return;
    modals.openImage(
      person.name,
      person.portrait,
      person.admin ? "Administrateur" : "",
    );
  });

  dom.modalClose.addEventListener("click", modals.closePortrait);
  dom.modal.addEventListener("click", (event) => {
    if (event.target.dataset.close === "true") modals.closePortrait();
  });

  /* A sheet that changes changes what the reader notices, so the passive
     reckoning is told at the same time as the app. */
  dom.psycheButton.addEventListener("click", () =>
    modals.openPsyche(state.sheetState, (next) => {
      state.sheetState = next;
      dialogue.setSheet(next);
    }),
  );
  dom.psycheClose.addEventListener("click", modals.closePsyche);
  dom.psycheModal.addEventListener("click", (event) => {
    if (event.target.dataset.close === "true") modals.closePsyche();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    modals.closePsyche();
    modals.closePortrait();
    modals.closeNpcModal();
  });
}

function bindNpcForm() {
  if (dom.npcButton) {
    dom.npcButton.addEventListener("click", () =>
      modals.openNpcModal(state.isAdmin, state.npcs, editNpc, removeNpc),
    );
  }
  if (dom.npcModalClose) {
    dom.npcModalClose.addEventListener("click", modals.closeNpcModal);
  }
  if (dom.npcModal) {
    dom.npcModal.addEventListener("click", (event) => {
      if (event.target.dataset.close === "true") modals.closeNpcModal();
    });
  }
  if (dom.npcCancelButton) {
    dom.npcCancelButton.addEventListener("click", modals.resetNpcForm);
  }

  if (dom.npcNameInput) {
    dom.npcNameInput.addEventListener("input", () => {
      paintThumb(dom.npcPortraitPreview, {
        name: cleanName(dom.npcNameInput.value),
        portrait: modals.getStagedNpcPortrait(),
      });
    });
  }

  if (dom.npcImageInput) {
    dom.npcImageInput.addEventListener("change", () => {
      const file = dom.npcImageInput.files?.[0];
      dom.npcFormError.textContent = "";
      if (!file) return;

      const rejection = rejectImageFile(file);
      if (rejection) {
        dom.npcImageInput.value = "";
        dom.npcFormError.textContent = rejection;
        return;
      }
      dom.npcFormError.textContent = "Uploading thumbnail…";
      uploadImage(file, (url, error) => {
        dom.npcImageInput.value = "";
        if (error) {
          dom.npcFormError.textContent = error;
          return;
        }
        dom.npcFormError.textContent = "";
        modals.setStagedNpcPortrait(url);
        dom.npcImageUrl.value = url;
        paintThumb(dom.npcPortraitPreview, {
          name: cleanName(dom.npcNameInput.value),
          portrait: url,
        });
      });
    });
  }

  if (dom.npcImageUrl) {
    dom.npcImageUrl.addEventListener("change", () => {
      dom.npcFormError.textContent = "";
      const raw = dom.npcImageUrl.value.trim();
      if (!raw) {
        modals.setStagedNpcPortrait(null);
        paintThumb(dom.npcPortraitPreview, {
          name: cleanName(dom.npcNameInput.value),
          portrait: null,
        });
        return;
      }
      const url = cleanImageUrl(raw);
      if (!url) {
        dom.npcFormError.textContent = "Use a full https image address.";
        return;
      }
      dom.npcFormError.textContent = "Checking address…";
      probeImage(url, (ok) => {
        if (!ok) {
          dom.npcFormError.textContent =
            "That address did not load as an image.";
          return;
        }
        dom.npcFormError.textContent = "";
        modals.setStagedNpcPortrait(url);
        paintThumb(dom.npcPortraitPreview, {
          name: cleanName(dom.npcNameInput.value),
          portrait: url,
        });
      });
    });
  }

  if (dom.npcForm) {
    dom.npcForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitNpcForm();
    });
  }
}

export function bindSession() {
  bindComposers();
  bindSaveFiles();
  bindDeck();
  bindModals();
  bindNpcForm();

  dom.leaveButton.addEventListener("click", leave);
  window.addEventListener("beforeunload", () => network.disconnect());
}
