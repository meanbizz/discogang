import {
  HISTORY_LIMIT,
  TURN_LIMIT,
  TURN_MIN_LENGTH,
  STATS_MAX_BYTES,
  PLAYER_SLOTS,
} from "./config.js";
import { dom, anchors, setPresent } from "./dom.js";
import {
  uid,
  cleanName,
  cleanText,
  cleanImageUrl,
  cleanScene,
  isAdminName,
  paintThumb,
  roomFromHash,
  randomRoomCode,
  copyText,
} from "./utils.js";
import { rejectImageFile, uploadImage, probeImage } from "./upload.js";
import * as audio from "./audio.js";
import * as vitals from "./vitals.js";
import * as modals from "./modals.js";
import { NetworkManager } from "./network.js";

/* ---------------- Application State ---------------- */
let isAdmin = false;
const roster = new Map();
let logEntries = [];
let turnEntries = [];
let npcs = [];
let selfReady = false;
let profile = { name: "", portrait: null };
let roomId = "";
let scene = { image: null };
let stagedPortrait = null;
let stagedSheet = null;
let sheetState = null;
let importResetTimer = null;

function setStatus(state, text) {
  dom.statusDot.setAttribute("data-state", state);
  dom.statusText.textContent = text;
}

function systemNote(text) {
  renderEntry({ system: true, text, at: Date.now() });
}

/* ---------------- Network Callbacks ---------------- */
const network = new NetworkManager({
  onStatus: setStatus,
  onSystemNote: systemNote,
  onHostStarted: (selfId, hostProfile) => {
    roster.set(selfId, hostProfile);
    renderRoster();
  },
  onPeerDrop: (peerId) => {
    roster.delete(peerId);
    renderRoster();
    network.broadcast(rosterPayload());
  },
  onHostReceiveData: (connection, data) => {
    const person = roster.get(connection.peer);

    if (data.type === "hello") {
      const name = cleanName(data.profile?.name) || "Unnamed";
      const joiningAdmin = isAdminName(name);
      const previous = roster.get(connection.peer);
      roster.set(connection.peer, {
        id: connection.peer,
        name,
        portrait: cleanImageUrl(data.profile?.portrait),
        admin: joiningAdmin,
        slot: joiningAdmin ? 0 : previous?.slot || network.nextSlot(roster),
        ready: false,
      });

      renderRoster();
      connection.send({
        type: "welcome",
        id: connection.peer,
        entries: logEntries,
        turns: turnEntries,
        track: audio.getCurrentTrack(),
        scene,
        npcs,
      });
      connection.send(rosterPayload());
      network.broadcast(rosterPayload(), connection.peer);
      return;
    }

    if (data.type === "entry") {
      if (!person?.admin) return;
      const body = cleanText(data.entry?.text);
      if (!body) return;
      const entry = {
        id: uid(),
        author: person.name,
        text: body,
        at: Date.now(),
      };
      commit(entry);
      network.broadcast({ type: "entry", entry });
      return;
    }

    if (data.type === "turn") {
      if (!person || person.admin) return;
      const plan = cleanText(data.turn?.text);
      if (plan.length < TURN_MIN_LENGTH) return;
      const planned = {
        id: uid(),
        authorId: person.id,
        author: person.name,
        text: plan,
        at: Date.now(),
      };
      commitTurn(planned);
      network.broadcast({ type: "turn", turn: planned });
      return;
    }

    if (data.type === "ready") {
      if (!person || person.admin) return;
      person.ready = Boolean(data.ready);
      renderRoster();
      network.broadcast(rosterPayload());
      return;
    }

    if (data.type === "scene-request") {
      if (!person?.admin) return;
      applyScene(data.scene);
      network.broadcast({ type: "scene", scene });
      return;
    }

    if (data.type === "track-request") {
      if (!person?.admin) return;
      const videoId = data.track
        ? audio.parseVideoId(data.track.videoId)
        : null;
      const track = videoId ? { videoId, startedAt: Date.now() } : null;
      audio.applyTrack(track, isAdmin);
      network.broadcast({ type: "track", track });
      return;
    }

    if (data.type === "npc-sync") {
      if (!person?.admin) return;
      setNpcs(data.npcs);
      network.broadcast({ type: "npcs", npcs }, connection.peer);
    }
  },
  onGuestReceiveData: (data) => {
    if (data.type === "welcome") {
      if (typeof data.id === "string") network.selfId = data.id;
      replaceLog(
        (Array.isArray(data.entries) ? data.entries : [])
          .map(normalizeEntry)
          .filter(Boolean),
      );
      replaceTurnLog(
        (Array.isArray(data.turns) ? data.turns : [])
          .map(normalizeEntry)
          .filter(Boolean),
      );
      applyScene(data.scene);
      if (Array.isArray(data.npcs)) setNpcs(data.npcs);
      const incoming =
        data.track && audio.parseVideoId(data.track.videoId)
          ? {
              videoId: audio.parseVideoId(data.track.videoId),
              startedAt: Number(data.track.startedAt) || Date.now(),
            }
          : null;
      audio.applyTrack(incoming, isAdmin);
      return;
    }

    if (data.type === "roster" && Array.isArray(data.people)) {
      roster.clear();
      data.people.forEach((raw) => {
        if (!raw || typeof raw.id !== "string") return;
        const name = cleanName(raw.name) || "Unnamed";
        let slot = Number(raw.slot) || 0;
        if (slot < 0 || slot > PLAYER_SLOTS) slot = 0;
        roster.set(raw.id, {
          id: raw.id,
          name,
          portrait: cleanImageUrl(raw.portrait),
          admin: isAdminName(name),
          slot,
          ready: Boolean(raw.ready),
        });
      });
      renderRoster();
      const me = roster.get(network.selfId);
      if (me && !isAdmin && Boolean(me.ready) !== selfReady) {
        selfReady = Boolean(me.ready);
        paintReadyButton();
      }
      replaceTurnLog(turnEntries);
      return;
    }

    if (data.type === "entry") {
      const entry = normalizeEntry(data.entry);
      if (entry) commit(entry);
      return;
    }

    if (data.type === "turn") {
      const planned = normalizeEntry(data.turn);
      if (planned) commitTurn(planned);
      return;
    }

    if (data.type === "scene") {
      applyScene(data.scene);
      return;
    }

    if (data.type === "npcs") {
      setNpcs(data.npcs);
      return;
    }

    if (data.type === "track") {
      const videoId = data.track
        ? audio.parseVideoId(data.track.videoId)
        : null;
      audio.applyTrack(
        videoId
          ? { videoId, startedAt: Number(data.track.startedAt) || Date.now() }
          : null,
        isAdmin,
      );
    }
  },
  onUpstreamClose: () => {
    roster.clear();
    renderRoster();
    systemNote("The room closed. Rejoin to reopen it.");
  },
});

function rosterPayload() {
  const people = [];
  roster.forEach((person) => people.push(person));
  return { type: "roster", people };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw.text !== "string") return null;
  const text = cleanText(raw.text);
  if (!text) return null;
  return {
    id: raw.id || uid(),
    author: cleanName(raw.author) || "Unnamed",
    authorId: typeof raw.authorId === "string" ? raw.authorId : "",
    text,
    at: Number(raw.at) || Date.now(),
    system: Boolean(raw.system),
  };
}

/* ---------------- Rendering Functions ---------------- */

function renderRoster() {
  dom.roster.textContent = "";
  renderReadyBanner();

  const people = [];
  roster.forEach((person) => {
    if (!person.admin) people.push(person);
  });

  if (!people.length) {
    const empty = document.createElement("p");
    empty.className = "roster-empty";
    empty.textContent = "Nobody here yet.";
    dom.roster.appendChild(empty);
    return;
  }

  people.forEach((person) => {
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className = "roster-person";
    wrapper.dataset.personId = person.id;
    if (person.id === network.selfId) wrapper.classList.add("self");
    wrapper.dataset.slot = String(person.slot || 0);

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    paintThumb(thumb, person);

    const name = document.createElement("span");
    name.className = "roster-name";
    name.textContent = person.name;

    const readyDot = document.createElement("span");
    readyDot.className = "roster-ready";
    if (person.ready) readyDot.setAttribute("data-ready", "true");

    wrapper.appendChild(thumb);
    wrapper.appendChild(name);
    wrapper.appendChild(readyDot);
    wrapper.title = person.name;
    wrapper.setAttribute("aria-label", `Portrait of ${person.name}`);
    dom.roster.appendChild(wrapper);
  });
}

function renderReadyBanner() {
  let players = 0;
  let readied = 0;
  roster.forEach((person) => {
    if (person.admin) return;
    players += 1;
    if (person.ready) readied += 1;
  });
  dom.readyBanner.hidden = !(isAdmin && players > 0 && readied === players);
}

function paintReadyButton() {
  dom.turnReady.textContent = selfReady ? "Ready ✓" : "Ready";
  dom.turnReady.setAttribute("aria-pressed", selfReady ? "true" : "false");
  dom.turnReady.classList.toggle("is-ready", selfReady);
}

function commit(entry) {
  logEntries.push(entry);
  if (logEntries.length > HISTORY_LIMIT) logEntries.shift();
  renderEntry(entry);
}

function renderEntry(entry) {
  const placeholder = dom.log.querySelector(".log-empty");
  if (placeholder) placeholder.remove();

  const previous = dom.log.querySelector(".entry.current");
  if (previous) previous.classList.remove("current");

  const wrapper = document.createElement("article");
  wrapper.className = "entry current";
  if (entry.system) wrapper.classList.add("system");

  const body = document.createElement("p");
  body.className = "entry-body";
  body.textContent = entry.text;
  wrapper.appendChild(body);

  const pinned =
    dom.log.scrollTop + dom.log.clientHeight >= dom.log.scrollHeight - 48;
  dom.log.appendChild(wrapper);
  if (pinned) dom.log.scrollTop = dom.log.scrollHeight;
}

function replaceLog(entries) {
  logEntries = entries.slice(-HISTORY_LIMIT);
  dom.log.textContent = "";
  logEntries.forEach(renderEntry);
  if (!logEntries.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "log-empty";
    placeholder.textContent =
      "The log is empty. Somebody should say something.";
    dom.log.appendChild(placeholder);
  }
  dom.log.scrollTop = dom.log.scrollHeight;
}

/* ---------------- Turn Builder ---------------- */

function paintMarkup(target, text) {
  const pattern = /"[^"]*"|\([^)]*\)|\*[^*]*\*/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      target.appendChild(
        document.createTextNode(text.slice(cursor, match.index)),
      );
    }
    const head = match[0].charAt(0);
    const piece = document.createElement("span");
    piece.className =
      head === '"' ? "mark-quote" : head === "(" ? "mark-aside" : "mark-past";
    piece.textContent = match[0];
    target.appendChild(piece);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    target.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function slotOf(personId, authorName) {
  let found = personId ? roster.get(personId) : null;
  if (!found) {
    roster.forEach((candidate) => {
      if (!found && !candidate.admin && candidate.name === authorName) {
        found = candidate;
      }
    });
  }
  return found && found.slot ? found.slot : 0;
}

function renderTurn(entry) {
  const placeholder = dom.turnLog.querySelector(".turn-empty");
  if (placeholder) placeholder.remove();

  const slot = String(slotOf(entry.authorId, entry.author));
  const line = document.createElement("p");
  line.className = "turn-line";

  const author = document.createElement("span");
  author.className = "turn-author";
  author.textContent = entry.author;
  author.dataset.slot = slot;
  line.appendChild(author);
  line.appendChild(document.createTextNode(" — "));

  const body = document.createElement("span");
  body.className = "turn-body";
  paintMarkup(body, entry.text);
  line.appendChild(body);

  const wrapper = document.createElement("article");
  wrapper.className = "turn-entry";
  wrapper.dataset.slot = slot;
  wrapper.appendChild(line);

  const pinned =
    dom.turnLog.scrollTop + dom.turnLog.clientHeight >=
    dom.turnLog.scrollHeight - 32;
  dom.turnLog.appendChild(wrapper);
  if (pinned) dom.turnLog.scrollTop = dom.turnLog.scrollHeight;
}

function commitTurn(entry) {
  turnEntries.push(entry);
  if (turnEntries.length > TURN_LIMIT) turnEntries.shift();
  renderTurn(entry);
}

function replaceTurnLog(entries) {
  turnEntries = entries.slice(-TURN_LIMIT);
  dom.turnLog.textContent = "";
  turnEntries.forEach(renderTurn);
  if (!turnEntries.length) renderTurnEmptyState();
  dom.turnLog.scrollTop = dom.turnLog.scrollHeight;
}

function renderTurnEmptyState() {
  if (dom.turnLog.children.length) return;
  const placeholder = document.createElement("p");
  placeholder.className = "turn-empty";
  placeholder.textContent = "Nothing planned yet.";
  dom.turnLog.appendChild(placeholder);
}

/* ---------------- Scene & NPCs ---------------- */

function renderScene() {
  paintThumb(dom.sceneThumb, { portrait: scene.image });
}

function applyScene(next) {
  scene = cleanScene(next);
  renderScene();
}

function pushScene(next) {
  if (!isAdmin) return;
  const candidate = cleanScene(next);

  if (network.isHost) {
    applyScene(candidate);
    network.broadcast({ type: "scene", scene });
    return;
  }
  applyScene(candidate);
  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "scene-request", scene: candidate });
    return;
  }
  dom.sceneError.textContent = "Not connected.";
}

function setNpcs(list) {
  npcs = (Array.isArray(list) ? list : []).map(modals.cleanNpc).filter(Boolean);
  modals.renderNpcList(npcs, editNpc, removeNpc);
}

function broadcastNpcs() {
  if (!isAdmin) return;
  if (network.isHost) {
    network.broadcast({ type: "npcs", npcs });
    return;
  }
  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "npc-sync", npcs });
  }
}

function editNpc(id) {
  const item = npcs.find((n) => n.id === id);
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

function removeNpc(id) {
  npcs = npcs.filter((n) => n.id !== id);
  if (dom.npcId.value === id) modals.resetNpcForm();
  modals.renderNpcList(npcs, editNpc, removeNpc);
  broadcastNpcs();
}

/* ---------------- User Actions ---------------- */

function setSelfReady(next) {
  if (isAdmin) return;
  selfReady = Boolean(next);
  paintReadyButton();

  if (network.isHost) {
    const me = roster.get(network.selfId);
    if (me) me.ready = selfReady;
    renderRoster();
    network.broadcast(rosterPayload());
    return;
  }
  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "ready", ready: selfReady });
  }
}

function shareText(text) {
  if (!isAdmin) return;
  const body = cleanText(text);
  if (!body) return;

  if (network.isHost) {
    const entry = {
      id: uid(),
      author: profile.name,
      text: body,
      at: Date.now(),
    };
    commit(entry);
    network.broadcast({ type: "entry", entry });
    return;
  }
  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "entry", entry: { text: body } });
    return;
  }
  systemNote("Not connected — that line went nowhere.");
}

function shareTurn(text) {
  if (isAdmin) return false;
  const body = cleanText(text);
  if (body.length < TURN_MIN_LENGTH) {
    dom.turnError.textContent = `A plan needs at least ${TURN_MIN_LENGTH} characters.`;
    return false;
  }
  dom.turnError.textContent = "";

  if (network.isHost) {
    const entry = {
      id: uid(),
      authorId: network.selfId,
      author: profile.name,
      text: body,
      at: Date.now(),
    };
    commitTurn(entry);
    network.broadcast({ type: "turn", turn: entry });
    return true;
  }
  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "turn", turn: { text: body } });
    return true;
  }
  return false;
}

function exportTurns() {
  if (!isAdmin) return;
  const lines = turnEntries.map((e) => `${e.author} — ${e.text}`);
  const transcript = `# Actions planned by players:\n${lines.join("\n")}`;
  copyText(transcript, (ok) => {
    if (importResetTimer) clearTimeout(importResetTimer);
    dom.importButton.textContent = ok ? "Copied ✓" : "Copy failed";
    importResetTimer = setTimeout(() => {
      dom.importButton.textContent = "Import";
    }, 1600);
  });
}

function connect(room, name, portrait) {
  network.sessionGeneration += 1;
  network.joinAttempts = 0;

  roomId = room;
  profile = { name, portrait };
  isAdmin = isAdminName(name);

  dom.roleLabel.hidden = !isAdmin;
  setPresent(anchors.deck, dom.deck, isAdmin);
  setPresent(anchors.adminTools, dom.adminTools, isAdmin);
  setPresent(anchors.composer, dom.composer, isAdmin);
  setPresent(anchors.sceneTools, dom.sceneTools, isAdmin);
  setPresent(anchors.turnComposer, dom.turnComposer, !isAdmin);
  setPresent(anchors.panelFoot, dom.panelFoot, !isAdmin);
  setPresent(anchors.readyBanner, dom.readyBanner, isAdmin);

  dom.joinPanel.hidden = true;
  dom.sessionPanel.hidden = false;

  setStatus("connecting", "Finding the room…");
  roster.clear();
  npcs = [];
  renderRoster();
  replaceLog([]);
  replaceTurnLog([]);
  selfReady = false;
  paintReadyButton();
  dom.turnError.textContent = "";

  applyScene({ image: null });
  sheetState = isAdmin ? null : window.DiscoSkillSheet?.normalize(stagedSheet);
  if (modals.getSheetInstance())
    modals.getSheetInstance().setState(sheetState, true);
  vitals.refreshVitals(sheetState, true);
  audio.describeTrack();
  audio.refreshAudioUnlockButton(isAdmin);

  if (location.hash.slice(1) !== roomId) location.hash = roomId;

  network.openRoom(roomId, profile, network.sessionGeneration);
  if (isAdmin) dom.textInput.focus();
  else dom.turnInput.focus();
}

function leave() {
  network.disconnect();
  audio.stopPlayer();

  modals.closePortrait();
  modals.closePsyche();
  modals.closeNpcModal();
  sheetState = null;
  stagedSheet = null;
  if (modals.getSheetInstance()) modals.getSheetInstance().setState(null, true);

  roster.clear();
  npcs = [];
  logEntries = [];
  turnEntries = [];
  isAdmin = false;

  dom.sessionPanel.hidden = true;
  dom.joinPanel.hidden = false;
  dom.log.textContent = "";
  dom.textInput.value = "";
  dom.turnLog.textContent = "";
  dom.turnInput.value = "";
  dom.turnError.textContent = "";

  selfReady = false;
  paintReadyButton();

  if (dom.deckError) dom.deckError.textContent = "";
  dom.sceneError.textContent = "";
  dom.sceneImageInput.value = "";
  dom.sceneImageUrl.value = "";
  if (dom.audioUnlock) dom.audioUnlock.hidden = true;
  if (dom.trackLabel) dom.trackLabel.textContent = "Silence.";
  dom.roleLabel.hidden = true;

  setPresent(anchors.deck, dom.deck, false);
  setPresent(anchors.adminTools, dom.adminTools, false);
  setPresent(anchors.composer, dom.composer, false);
  setPresent(anchors.sceneTools, dom.sceneTools, false);
  setPresent(anchors.turnComposer, dom.turnComposer, false);
  setPresent(anchors.panelFoot, dom.panelFoot, false);
  setPresent(anchors.readyBanner, dom.readyBanner, false);

  dom.statsInput.value = "";
  vitals.refreshVitals(null, true);
  renderTurnEmptyState();
  applyScene({ image: null });
  setStatus("offline", "Offline");
  dom.nameInput.focus();
}

/* ---------------- Event Listeners ---------------- */

function paintPreview() {
  paintThumb(dom.portraitPreview, {
    name: cleanName(dom.nameInput.value),
    portrait: stagedPortrait,
  });
}

dom.portraitInput.addEventListener("change", () => {
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
    stagedPortrait = url;
    dom.portraitUrl.value = url;
    paintPreview();
  });
});

dom.portraitUrl.addEventListener("change", () => {
  dom.joinError.textContent = "";
  const raw = dom.portraitUrl.value.trim();
  if (!raw) {
    stagedPortrait = null;
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
    stagedPortrait = url;
    dom.portraitUrl.value = url;
    paintPreview();
  });
});

dom.statsInput.addEventListener("change", () => {
  const file = dom.statsInput.files?.[0];
  dom.joinError.textContent = "";
  if (!file) {
    stagedSheet = null;
    return;
  }
  if (file.size > STATS_MAX_BYTES) {
    dom.statsInput.value = "";
    stagedSheet = null;
    dom.joinError.textContent = "That stats file is too large.";
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => {
    dom.statsInput.value = "";
    stagedSheet = null;
    dom.joinError.textContent = "That file could not be read.";
  };
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (error) {
      dom.statsInput.value = "";
      stagedSheet = null;
      dom.joinError.textContent = "That file is not valid JSON.";
      return;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (!parsed.attributes && !parsed.skills)
    ) {
      dom.statsInput.value = "";
      stagedSheet = null;
      dom.joinError.textContent = "That JSON holds no attributes or skills.";
      return;
    }
    stagedSheet = window.DiscoSkillSheet?.normalize(parsed);
    dom.joinError.textContent = "Stats loaded.";
  };
  reader.readAsText(file);
});

dom.nameInput.addEventListener("input", () => {
  if (!stagedPortrait) paintPreview();
});

dom.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = cleanName(dom.nameInput.value);
  if (!name) {
    dom.joinError.textContent = "Your character needs a name.";
    return;
  }
  const room = roomFromHash() || randomRoomCode();
  dom.joinError.textContent = "";
  dom.joinButton.disabled = true;
  connect(room, name, stagedPortrait);
  dom.joinButton.disabled = false;
});

dom.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  shareText(dom.textInput.value);
  dom.textInput.value = "";
  dom.textInput.focus();
});

dom.textInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (dom.composer.requestSubmit) {
      dom.composer.requestSubmit();
    } else {
      shareText(dom.textInput.value);
      dom.textInput.value = "";
    }
  }
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
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (dom.turnComposer.requestSubmit) {
      dom.turnComposer.requestSubmit();
    } else if (shareTurn(dom.turnInput.value)) {
      dom.turnInput.value = "";
    }
  }
});

dom.turnReady.addEventListener("click", () => setSelfReady(!selfReady));
dom.importButton.addEventListener("click", exportTurns);

dom.sceneThumb.addEventListener("click", () =>
  modals.openImage("Scene", scene.image, ""),
);

dom.sceneImageInput.addEventListener("change", () => {
  const file = dom.sceneImageInput.files?.[0];
  dom.sceneError.textContent = "";
  if (!file) return;

  const rejection = rejectImageFile(file);
  if (rejection) {
    dom.sceneImageInput.value = "";
    dom.sceneError.textContent = rejection;
    return;
  }
  dom.sceneError.textContent = "Uploading…";
  uploadImage(file, (url, error) => {
    dom.sceneImageInput.value = "";
    if (error) {
      dom.sceneError.textContent = error;
      return;
    }
    dom.sceneError.textContent = "";
    dom.sceneImageUrl.value = url;
    pushScene({ image: url });
  });
});

dom.sceneImageUrl.addEventListener("change", () => {
  dom.sceneError.textContent = "";
  const raw = dom.sceneImageUrl.value.trim();
  if (!raw) {
    pushScene({ image: null });
    return;
  }
  const url = cleanImageUrl(raw);
  if (!url) {
    dom.sceneError.textContent = "Use a full https image address.";
    return;
  }
  dom.sceneError.textContent = "Checking…";
  probeImage(url, (ok) => {
    if (!ok) {
      dom.sceneError.textContent = "That address did not load.";
      return;
    }
    dom.sceneError.textContent = "";
    dom.sceneImageUrl.value = url;
    pushScene({ image: url });
  });
});

if (dom.trackPlay) {
  dom.trackPlay.addEventListener("click", () => {
    dom.deckError.textContent = "";
    const videoId = audio.parseVideoId(dom.trackUrl.value);
    if (!videoId) {
      dom.deckError.textContent = "That does not look like a YouTube link.";
      return;
    }
    audio.markAudioUnlocked();
    const track = videoId ? { videoId, startedAt: Date.now() } : null;
    if (network.isHost) {
      audio.applyTrack(track, isAdmin);
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
      audio.applyTrack(null, isAdmin);
      network.broadcast({ type: "track", track: null });
    } else if (network.upstream?.open) {
      network.upstream.send({ type: "track-request", track: null });
    }
  });
}

if (dom.audioUnlock) {
  dom.audioUnlock.addEventListener("click", () => {
    audio.markAudioUnlocked();
    dom.audioUnlock.hidden = true;
    const current = audio.getCurrentTrack();
    const player = audio.getPlayer();
    if (player && current) {
      player.seekTo(audio.trackOffsetSeconds(current), true);
    } else if (current) {
      audio.applyTrack(current, isAdmin);
    }
  });
}

// Global audio unlocks
document.addEventListener("pointerdown", audio.markAudioUnlocked, {
  capture: true,
  once: true,
});
document.addEventListener("keydown", audio.markAudioUnlocked, {
  capture: true,
  once: true,
});

// Modals
dom.roster.addEventListener("click", (event) => {
  const target = event.target.closest(".roster-person");
  if (!target?.dataset.personId) return;
  const person = roster.get(target.dataset.personId);
  if (person) {
    modals.openImage(
      person.name,
      person.portrait,
      person.admin ? "Administrateur" : "",
    );
  }
});

dom.modalClose.addEventListener("click", modals.closePortrait);
dom.modal.addEventListener("click", (e) => {
  if (e.target.dataset.close === "true") modals.closePortrait();
});

dom.psycheButton.addEventListener("click", () =>
  modals.openPsyche(sheetState, (next) => {
    sheetState = next;
  }),
);
dom.psycheClose.addEventListener("click", modals.closePsyche);
dom.psycheModal.addEventListener("click", (e) => {
  if (e.target.dataset.close === "true") modals.closePsyche();
});

if (dom.npcButton)
  dom.npcButton.addEventListener("click", () =>
    modals.openNpcModal(isAdmin, npcs, editNpc, removeNpc),
  );
if (dom.npcModalClose)
  dom.npcModalClose.addEventListener("click", modals.closeNpcModal);
if (dom.npcModal) {
  dom.npcModal.addEventListener("click", (e) => {
    if (e.target.dataset.close === "true") modals.closeNpcModal();
  });
}
if (dom.npcCancelButton)
  dom.npcCancelButton.addEventListener("click", modals.resetNpcForm);

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
        dom.npcFormError.textContent = "That address did not load as an image.";
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
    const name = cleanName(dom.npcNameInput.value);
    if (!name) {
      dom.npcFormError.textContent = "NPC requires a name.";
      return;
    }
    const targetId = dom.npcId.value;
    if (targetId) {
      const existing = npcs.find((n) => n.id === targetId);
      if (existing) {
        existing.name = name;
        existing.thumbnail = modals.getStagedNpcPortrait();
      }
    } else {
      npcs.push({
        id: uid(),
        name,
        thumbnail: modals.getStagedNpcPortrait(),
      });
    }
    modals.resetNpcForm();
    modals.renderNpcList(npcs, editNpc, removeNpc);
    broadcastNpcs();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  modals.closePsyche();
  modals.closePortrait();
  modals.closeNpcModal();
});

dom.leaveButton.addEventListener("click", leave);
window.addEventListener("beforeunload", () => network.disconnect());

/* ---------------- Bootstrap ---------------- */
(function bootstrap() {
  vitals.refreshVitals(null, true);
  renderScene();
  renderTurnEmptyState();
  paintReadyButton();
  dom.nameInput.focus();
  setStatus("offline", "Offline");
})();
