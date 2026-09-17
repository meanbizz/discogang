/* The join form: portrait upload or address, the optional stats sheet, and
   the submit that opens the room. */

import { STATS_MAX_BYTES } from "../config.js";
import { dom } from "../dom.js";
import {
  cleanImageUrl,
  cleanName,
  isAdminName,
  paintThumb,
  randomRoomCode,
  roomFromHash,
} from "../utils.js";
import { probeImage, rejectImageFile, uploadImage } from "../upload.js";
import { state } from "./state.js";
import { connect } from "./room.js";

let autoPortrait = null;
let autoSheet = false;
let folderLookupId = 0;

/* Everything the join form waits on, counted so the button comes back when
   the last load lands — success, failure or superseded alike. */
let busyLoads = 0;

function beginLoad(lock) {
  busyLoads += 1;
  if (lock) dom.joinButton.disabled = true;
}

function endLoad() {
  busyLoads = Math.max(0, busyLoads - 1);
  if (!busyLoads) dom.joinButton.disabled = false;
}

function playerSlug(name) {
  const clean = cleanName(name).toLowerCase();
  return clean ? clean.replace(/\s+/g, "_") : "";
}

function folderAsset(slug, file) {
  return new URL("players/" + encodeURIComponent(slug) + "/" + file, window.location.href).href;
}

/* Tries each portrait candidate in order until one loads successfully. */
function findPortrait(slug, done) {
  const candidates = [
    folderAsset(slug, "portrait.jpeg"),
    folderAsset(slug, "portrait.png"),
    folderAsset(slug, "portrait.jpg"),
  ];
  function next(index) {
    if (index >= candidates.length) return done(null);
    probeImage(candidates[index], (ok) => {
      if (ok) done(candidates[index]);
      else next(index + 1);
    });
  }
  next(0);
}

function findSkills(slug, done) {
  fetch(folderAsset(slug, "skills.json"))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && typeof data === "object" && !Array.isArray(data) && (data.attributes || data.skills)) {
        done(data);
      } else {
        done(null);
      }
    })
    .catch(() => done(null));
}

/* Resolves folder assets for non-admin names unless manually overridden. */
function syncPlayerFolder(name, done) {
  const currentId = ++folderLookupId;
  const slug = playerSlug(name);
  if (!slug || isAdminName(name)) {
    if (autoPortrait && state.stagedPortrait === autoPortrait) {
      state.stagedPortrait = null;
      paintPreview();
    }
    if (autoSheet) {
      state.stagedSheet = null;
      autoSheet = false;
      if (dom.joinError.textContent === "Stats loaded.") dom.joinError.textContent = "";
    }
    if (done) done();
    return;
  }

  let pending = 2;
  const finish = () => {
    pending -= 1;
    if (pending === 0 && done) done();
  };
  /* Only Join, which waits on this lookup, presses the button down; the
     name-blur lookup counts quietly, so it cannot swallow the click. */
  const lock = Boolean(done);

  beginLoad(lock);
  findPortrait(slug, (url) => {
    /* Superseded by a newer lookup: release the claim, settle nothing else. */
    if (currentId !== folderLookupId) return endLoad();
    const manualPortrait = dom.portraitInput.files?.[0] || (dom.portraitUrl.value.trim() && state.stagedPortrait !== autoPortrait);
    if (!manualPortrait) {
      autoPortrait = url;
      state.stagedPortrait = url;
      paintPreview();
    }
    endLoad();
    finish();
  });

  beginLoad(lock);
  findSkills(slug, (data) => {
    if (currentId !== folderLookupId) return endLoad();
    const manualSheet = dom.statsInput.files?.[0] || (state.stagedSheet && !autoSheet);
    if (!manualSheet) {
      if (data) {
        state.stagedSheet = window.DiscoSkillSheet?.normalize(data);
        autoSheet = true;
        dom.joinError.textContent = "Stats loaded.";
      } else if (autoSheet) {
        state.stagedSheet = null;
        autoSheet = false;
        if (dom.joinError.textContent === "Stats loaded.") dom.joinError.textContent = "";
      }
    }
    endLoad();
    finish();
  });
}

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
  autoPortrait = null;

  const rejection = rejectImageFile(file);
  if (rejection) {
    dom.portraitInput.value = "";
    dom.joinError.textContent = rejection;
    return;
  }

  dom.joinError.textContent = "Uploading the portrait…";
  beginLoad(true);
  uploadImage(file, (url, error) => {
    endLoad();
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
  autoPortrait = null;
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
  autoSheet = false;
  if (!file) {
    state.stagedSheet = null;
    return;
  }
  if (file.size > STATS_MAX_BYTES) {
    refuseSheet("That stats file is too large.");
    return;
  }

  beginLoad(true);
  const reader = new FileReader();
  reader.onerror = () => {
    endLoad();
    refuseSheet("That file could not be read.");
  };
  reader.onload = () => {
    endLoad();
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
  syncPlayerFolder(name, () => {
    connect(room, name, state.stagedPortrait);
    dom.joinButton.disabled = false;
  });
}

export function bindJoin() {
  dom.portraitInput.addEventListener("change", onPortraitFile);
  dom.portraitUrl.addEventListener("change", onPortraitUrl);
  dom.statsInput.addEventListener("change", onStatsFile);
  dom.nameInput.addEventListener("input", () => {
    if (!state.stagedPortrait) paintPreview();
  });
  dom.nameInput.addEventListener("blur", () => {
    syncPlayerFolder(dom.nameInput.value);
  });
  dom.joinForm.addEventListener("submit", onSubmit);
}
