/* The join form: portrait upload or address, the optional stats sheet, and
   the submit that opens the room. */

import { STATS_MAX_BYTES } from "../config.js";
import { dom } from "../dom.js";
import {
  cleanImageUrl,
  cleanName,
  paintThumb,
  randomRoomCode,
  roomFromHash,
} from "../utils.js";
import { probeImage, rejectImageFile, uploadImage } from "../upload.js";
import { state } from "./state.js";
import { connect } from "./room.js";

function paintPreview() {
  paintThumb(dom.portraitPreview, {
    name: cleanName(dom.nameInput.value),
    portrait: state.stagedPortrait,
  });
}

function onPortraitFile() {
  const file = dom.portraitInput.files?.[0];
  dom.joinError.textContent = "";
  if (!file) return;

  const rejection = rejectImageFile(file);
  if (rejection) {
    dom.portraitInput.value = "";
    dom.joinError.textContent = rejection;
    return;
  }

  dom.joinError.textContent = "Uploading the portrait…";
  dom.joinButton.disabled = true;
  uploadImage(file, (url, error) => {
    dom.joinButton.disabled = false;
    dom.portraitInput.value = "";
    if (error) {
      dom.joinError.textContent = error;
      return;
    }
    dom.joinError.textContent = "";
    state.stagedPortrait = url;
    dom.portraitUrl.value = url;
    paintPreview();
  });
}

function onPortraitUrl() {
  dom.joinError.textContent = "";
  const raw = dom.portraitUrl.value.trim();
  if (!raw) {
    state.stagedPortrait = null;
    paintPreview();
    return;
  }
  const url = cleanImageUrl(raw);
  if (!url) {
    dom.joinError.textContent = "Use a full https image address.";
    return;
  }
  dom.joinError.textContent = "Checking that address…";
  probeImage(url, (ok) => {
    if (!ok) {
      dom.joinError.textContent = "That address did not load as an image.";
      return;
    }
    dom.joinError.textContent = "";
    state.stagedPortrait = url;
    dom.portraitUrl.value = url;
    paintPreview();
  });
}

function refuseSheet(message) {
  dom.statsInput.value = "";
  state.stagedSheet = null;
  dom.joinError.textContent = message;
}

function onStatsFile() {
  const file = dom.statsInput.files?.[0];
  dom.joinError.textContent = "";
  if (!file) {
    state.stagedSheet = null;
    return;
  }
  if (file.size > STATS_MAX_BYTES) {
    refuseSheet("That stats file is too large.");
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => refuseSheet("That file could not be read.");
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (error) {
      refuseSheet("That file is not valid JSON.");
      return;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (!parsed.attributes && !parsed.skills)
    ) {
      refuseSheet("That JSON holds no attributes or skills.");
      return;
    }
    state.stagedSheet = window.DiscoSkillSheet?.normalize(parsed);
    dom.joinError.textContent = "Stats loaded.";
  };
  reader.readAsText(file);
}

function onSubmit(event) {
  event.preventDefault();
  const name = cleanName(dom.nameInput.value);
  if (!name) {
    dom.joinError.textContent = "Your character needs a name.";
    return;
  }
  const room = roomFromHash() || randomRoomCode();
  dom.joinError.textContent = "";
  dom.joinButton.disabled = true;
  connect(room, name, state.stagedPortrait);
  dom.joinButton.disabled = false;
}

export function bindJoin() {
  dom.portraitInput.addEventListener("change", onPortraitFile);
  dom.portraitUrl.addEventListener("change", onPortraitUrl);
  dom.statsInput.addEventListener("change", onStatsFile);
  dom.nameInput.addEventListener("input", () => {
    if (!state.stagedPortrait) paintPreview();
  });
  dom.joinForm.addEventListener("submit", onSubmit);
}
