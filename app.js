(function () {
  "use strict";

  var MAX_JOIN_ATTEMPTS = 4;
  var RETRY_DELAY_MS = 1200;

  var sessionGeneration = 0; // bumped on join and leave; stale handlers check it
  var joinAttempts = 0;

  var ROOM_PREFIX = "de-salon-";
  var ADMIN_NAME = "administrateur";
  var MAX_MESSAGE_LENGTH = 4000;
  var MAX_NAME_LENGTH = 24;
  var HISTORY_LIMIT = 200;
  var TURN_LIMIT = 120;
  var TURN_MIN_LENGTH = 3;
  var PLAYER_SLOTS = 8; // colour slots hardcoded in the stylesheet
  var ROOM_CODE_LENGTH = 8;
  var ROOM_CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 chars, no lookalikes
  var ROOM_CODE_MIN = 4;
  var ROOM_CODE_MAX = 32;

  var STATS_MAX_BYTES = 256 * 1024;
  var VITAL_SKILL = { health: "endurance", morale: "volition" };

  // cloudinary
  var IMAGE_HOST = {
    cloudName: "w9puemf3", // e.g. "dq1example"
    uploadPreset: "portraits", // e.g. "salon-portraits"
  };

  var IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  var IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  var IMAGE_URL_MAX_CHARS = 2048;

  var dom = {
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
  };

  /* ---------------- state ---------------- */

  var peer = null;
  var isHost = false;
  var isAdmin = false;
  var upstream = null; // guest -> owner connection
  var downstream = new Map(); // owner: peerId -> connection
  var logEntries = []; // authoritative on the owner, mirrored elsewhere
  var turnEntries = []; // planned turns, owned by the host like the log
  var roster = new Map(); // peerId -> { id, name, portrait, admin }
  var selfId = null;
  var selfReady = false;
  var profile = { name: "", portrait: null };
  var roomId = "";
  var currentTrack = null; // { videoId, startedAt } | null
  var scene = { image: null }; // owned by the administrateur
  var stagedPortrait = null;
  var stagedSheet = null; // parsed from an uploaded stats file, if any
  var modalReturnFocus = null;
  var importResetTimer = null; // resets the Import button label after a copy

  var sheet = null; // DiscoSkillSheet instance, built on first open
  var sheetState = null; // this player's own stats
  var psycheReturnFocus = null;

  var vitals = {
    health: { value: 0, max: 0 },
    morale: { value: 0, max: 0 },
  };

  /* ---------------- admin-only DOM ---------------- */

  // The deck, the composer and the scene controls are taken out of the document
  // rather than merely hidden, so a player has nothing to read, inspect or
  // re-enable. The turn composer and the panel foot are the mirror image:
  // absent for the administrateur, present for everybody else. Anchors
  // remember where each one belongs.
  var deckAnchor = document.createComment("deck");
  var composerAnchor = document.createComment("composer");
  var sceneToolsAnchor = document.createComment("scene-tools");
  var turnComposerAnchor = document.createComment("turn-composer");
  var panelFootAnchor = document.createComment("panel-foot");
  var readyBannerAnchor = document.createComment("ready-banner");

  function detach(anchor, node) {
    if (node.parentNode) {
      node.parentNode.insertBefore(anchor, node);
      node.remove();
    }
  }

  detach(deckAnchor, dom.deck);
  detach(composerAnchor, dom.composer);
  detach(sceneToolsAnchor, dom.sceneTools);
  detach(turnComposerAnchor, dom.turnComposer);
  // Vitals and the skills button belong to a character; the administrateur has none.
  detach(panelFootAnchor, dom.panelFoot);
  // Only the administrateur is told the table is ready.
  detach(readyBannerAnchor, dom.readyBanner);

  function setPresent(anchor, node, present) {
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

  /* ---------------- helpers ---------------- */

  function sanitizeRoomCode(value) {
    var code = String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, ROOM_CODE_MAX);
    return code.length >= ROOM_CODE_MIN ? code : "";
  }

  function randomRoomCode() {
    var out = "";
    var source = window.crypto || window.msCrypto;
    if (source && source.getRandomValues) {
      var bytes = new Uint8Array(ROOM_CODE_LENGTH);
      source.getRandomValues(bytes);
      // 256 is a whole multiple of 32, so plain modulo introduces no bias.
      for (var i = 0; i < bytes.length; i += 1) {
        out += ROOM_CODE_ALPHABET.charAt(bytes[i] % ROOM_CODE_ALPHABET.length);
      }
      return out;
    }
    for (var j = 0; j < ROOM_CODE_LENGTH; j += 1) {
      out += ROOM_CODE_ALPHABET.charAt(
        Math.floor(Math.random() * ROOM_CODE_ALPHABET.length),
      );
    }
    return out;
  }

  function roomFromHash() {
    var raw = location.hash.slice(1);
    if (!raw) return "";
    try {
      raw = decodeURIComponent(raw);
    } catch (error) {
      /* malformed escape: fall through with the raw value */
    }
    return sanitizeRoomCode(raw);
  }

  function uid() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
    );
  }

  function cleanName(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH);
  }

  function cleanText(value) {
    return String(value == null ? "" : value)
      .slice(0, MAX_MESSAGE_LENGTH)
      .trim();
  }

  // Anything arriving from a peer is re-parsed as a URL and accepted only as a
  // plain https address: no data: or javascript: payloads, no embedded
  // credentials, no bare hostnames, and a hard length ceiling.
  function cleanImageUrl(value) {
    if (typeof value !== "string") return null;
    var raw = value.trim();
    if (!raw || raw.length > IMAGE_URL_MAX_CHARS) return null;

    var parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return null;
    }
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname || parsed.hostname.indexOf(".") === -1) return null;

    var href = parsed.href;
    // URL normalisation already escapes these; the guard is belt and braces
    // against ever breaking out of the url("…") wrapper below.
    if (/["'\\\s]/.test(href)) return null;
    return href;
  }

  function cssUrl(href) {
    return 'url("' + href + '")';
  }

  function cleanScene(raw) {
    if (!raw || typeof raw !== "object") return { image: null };
    return { image: cleanImageUrl(raw.image) };
  }

  function isAdminName(name) {
    return cleanName(name).toLowerCase() === ADMIN_NAME;
  }

  function setStatus(state, text) {
    dom.statusDot.setAttribute("data-state", state);
    dom.statusText.textContent = text;
  }

  function paintThumb(element, person) {
    element.style.backgroundImage = person.portrait
      ? cssUrl(person.portrait)
      : "";
    if (person.portrait) {
      element.removeAttribute("data-empty");
      element.textContent = "";
    } else {
      element.setAttribute("data-empty", "true");
      element.textContent = person.name ? person.name.charAt(0) : "";
    }
  }

  /* ---------------- image intake ---------------- */

  function uploadConfigured() {
    return !!(IMAGE_HOST.cloudName && IMAGE_HOST.uploadPreset);
  }

  function rejectImageFile(file) {
    if (IMAGE_TYPES.indexOf(file.type) === -1) {
      return "Use a PNG, JPEG, WebP or GIF image.";
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return "That image is larger than 5 MB.";
    }
    if (!uploadConfigured()) {
      return "No image host is configured. Paste an image address instead.";
    }
    return "";
  }

  // The file goes straight to the host from the browser; the room only ever
  // learns the address that comes back.
  function uploadImage(file, done) {
    var endpoint =
      "https://api.cloudinary.com/v1_1/" +
      encodeURIComponent(IMAGE_HOST.cloudName) +
      "/image/upload";

    var body = new FormData();
    body.append("file", file);
    body.append("upload_preset", IMAGE_HOST.uploadPreset);

    fetch(endpoint, { method: "POST", mode: "cors", body: body })
      .then(function (response) {
        if (!response.ok) throw new Error("upload rejected");
        return response.json();
      })
      .then(function (data) {
        var url = cleanImageUrl(data && data.secure_url);
        if (!url) throw new Error("no usable address returned");
        done(url, null);
      })
      .catch(function () {
        done(null, "The image host refused that upload.");
      });
  }

  // A pasted address is worth nothing until it actually decodes as an image,
  // so it is fetched once here rather than failing silently in a frame later.
  function probeImage(url, done) {
    var probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onload = function () {
      done(true);
    };
    probe.onerror = function () {
      done(false);
    };
    probe.src = url;
  }

  /* ---------------- image modal ---------------- */

  function openImage(name, image, role) {
    paintThumb(dom.modalImage, { name: name, portrait: image });
    dom.modalName.textContent = name || "—";
    dom.modalRole.textContent = role || "";
    dom.modalRole.hidden = !role;

    modalReturnFocus =
      document.activeElement && document.activeElement.focus
        ? document.activeElement
        : null;
    dom.modal.hidden = false;
    dom.modalClose.focus();
  }

  function openPortrait(personId) {
    var person = roster.get(personId);
    if (!person) return;
    openImage(
      person.name,
      person.portrait,
      person.admin ? "Administrateur" : "",
    );
  }

  function openScene() {
    openImage(scene.image, "");
  }

  function closePortrait() {
    if (dom.modal.hidden) return;
    dom.modal.hidden = true;
    dom.modalImage.style.backgroundImage = "";
    dom.modalImage.textContent = "";
    if (modalReturnFocus && document.contains(modalReturnFocus)) {
      modalReturnFocus.focus();
    }
    modalReturnFocus = null;
  }

  /* ---------------- scene ---------------- */

  function renderScene() {
    paintThumb(dom.sceneThumb, { portrait: scene.image });
  }

  function applyScene(next) {
    scene = cleanScene(next);
    renderScene();
  }

  // Admin-side edit: applied locally, then owned and echoed by the host.
  function pushScene(next) {
    if (!isAdmin) return;
    var candidate = cleanScene(next);

    if (isHost) {
      applyScene(candidate);
      broadcast({ type: "scene", scene: scene });
      return;
    }
    applyScene(candidate);
    if (upstream && upstream.open) {
      upstream.send({ type: "scene-request", scene: candidate });
      return;
    }
    dom.sceneError.textContent = "Not connected.";
  }

  /* ---------------- vitals ---------------- */

  // A skill's score is its attribute plus allocated points plus the signature
  // bonus — the same arithmetic the sheet does, read here without one.
  function skillScore(state, skillId) {
    if (!state || !state.attributes || !state.skills) return 1;
    var groups = DiscoSkillSheet.ATTRIBUTES;
    for (var i = 0; i < groups.length; i += 1) {
      for (var j = 0; j < groups[i].skills.length; j += 1) {
        if (groups[i].skills[j].id !== skillId) continue;
        var owner = Number(state.attributes[groups[i].id]) || 1;
        var skill = state.skills[skillId] || {};
        return owner + (Number(skill.points) || 0) + (skill.signature ? 1 : 0);
      }
    }
    return 1;
  }

  function vitalMax(kind) {
    return skillScore(sheetState, VITAL_SKILL[kind]) + 1;
  }

  function renderBar(element, label, filled, total) {
    element.textContent = "";
    for (var i = 0; i < total; i += 1) {
      var step = document.createElement("span");
      step.className = "vital-step";
      if (i < filled) step.setAttribute("data-filled", "true");
      element.appendChild(step);
    }
    element.setAttribute("aria-label", label + " " + filled + " of " + total);
  }

  function renderVitals() {
    renderBar(dom.healthBar, "Health", vitals.health.value, vitals.health.max);
    renderBar(dom.moraleBar, "Morale", vitals.morale.value, vitals.morale.max);
  }

  // fill: start the bars full. Otherwise a widened ceiling carries its own
  // extra steps in, and a narrowed one trims the overflow.
  function refreshVitals(fill) {
    Object.keys(vitals).forEach(function (kind) {
      var state = vitals[kind];
      var next = vitalMax(kind);
      if (fill) state.value = next;
      else if (next > state.max) state.value += next - state.max;
      state.max = next;
      if (state.value > next) state.value = next;
      if (state.value < 0) state.value = 0;
    });
    renderVitals();
  }

  /* ---------------- psyche sheet ---------------- */

  function openPsyche() {
    if (!dom.psycheModal.hidden) return;

    if (!sheet) {
      sheet = new DiscoSkillSheet(dom.psycheSheet, {
        editable: false,
        state: sheetState,
        onChange: function (next) {
          sheetState = next;
          refreshVitals(false);
        },
      });
      sheetState = sheet.getState();
    } else {
      sheet.setState(sheetState, true);
    }

    psycheReturnFocus =
      document.activeElement && document.activeElement.focus
        ? document.activeElement
        : null;
    dom.psycheModal.hidden = false;
    dom.psycheClose.focus();
  }

  function closePsyche() {
    if (dom.psycheModal.hidden) return;
    if (sheet) sheet.hideTooltip();
    dom.psycheModal.hidden = true;
    if (psycheReturnFocus && document.contains(psycheReturnFocus)) {
      psycheReturnFocus.focus();
    }
    psycheReturnFocus = null;
  }

  /* ---------------- rendering ---------------- */

  // Colours live in the stylesheet as slots 1..PLAYER_SLOTS. The host hands out
  // the lowest free slot and ships it in the roster, so every client paints the
  // same player the same colour.
  function nextSlot() {
    var taken = {};
    roster.forEach(function (person) {
      if (person.slot) taken[person.slot] = true;
    });
    for (var i = 1; i <= PLAYER_SLOTS; i += 1) {
      if (!taken[i]) return i;
    }
    return 0;
  }

  function slotOf(personId, authorName) {
    var found = personId ? roster.get(personId) : null;
    if (!found) {
      roster.forEach(function (candidate) {
        if (!found && !candidate.admin && candidate.name === authorName) {
          found = candidate;
        }
      });
    }
    return found && found.slot ? found.slot : 0;
  }

  function renderReady() {
    var players = 0;
    var readied = 0;
    roster.forEach(function (person) {
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

  // Ready is a player's own flag; the host owns the copy everybody reads.
  function setSelfReady(next) {
    if (isAdmin) return;
    selfReady = !!next;
    paintReadyButton();

    if (isHost) {
      var me = roster.get(selfId);
      if (me) me.ready = selfReady;
      renderRoster();
      broadcast(rosterPayload());
      return;
    }
    if (upstream && upstream.open) {
      upstream.send({ type: "ready", ready: selfReady });
    }
  }

  function renderRoster() {
    dom.roster.textContent = "";
    renderReady();

    // The administrateur is not a character, so no portrait stands in for one.
    var people = [];
    roster.forEach(function (person) {
      if (!person.admin) people.push(person);
    });

    if (!people.length) {
      var empty = document.createElement("p");
      empty.className = "roster-empty";
      empty.textContent = "Nobody here yet.";
      dom.roster.appendChild(empty);
      return;
    }

    people.forEach(function (person) {
      // A button so the portrait is reachable by keyboard as well as pointer.
      var wrapper = document.createElement("button");
      wrapper.type = "button";
      wrapper.className = "roster-person";
      wrapper.dataset.personId = person.id;

      if (person.id === selfId) wrapper.classList.add("self");

      wrapper.dataset.slot = String(person.slot || 0);

      var thumb = document.createElement("div");
      thumb.className = "thumb";
      paintThumb(thumb, person);

      var name = document.createElement("span");
      name.className = "roster-name";
      name.textContent = person.name;

      var readyDot = document.createElement("span");
      readyDot.className = "roster-ready";
      if (person.ready) readyDot.setAttribute("data-ready", "true");

      wrapper.appendChild(thumb);
      wrapper.appendChild(name);
      wrapper.appendChild(readyDot);

      wrapper.title = person.name;
      wrapper.setAttribute("aria-label", "Portrait of " + person.name);
      dom.roster.appendChild(wrapper);
    });
  }

  function renderEmptyState() {
    if (dom.log.children.length) return;
    var placeholder = document.createElement("p");
    placeholder.className = "log-empty";
    placeholder.textContent =
      "The log is empty. Somebody should say something.";
    dom.log.appendChild(placeholder);
  }

  // Shared text is inserted with textContent only, so it can never run as markup.
  function renderEntry(entry) {
    var placeholder = dom.log.querySelector(".log-empty");
    if (placeholder) placeholder.remove();

    var previous = dom.log.querySelector(".entry.current");
    if (previous) previous.classList.remove("current");

    var wrapper = document.createElement("article");
    wrapper.className = "entry current";
    if (entry.system) wrapper.classList.add("system");

    var body = document.createElement("p");
    body.className = "entry-body";
    body.textContent = entry.text;
    wrapper.appendChild(body);

    var pinned =
      dom.log.scrollTop + dom.log.clientHeight >= dom.log.scrollHeight - 48;
    dom.log.appendChild(wrapper);
    if (pinned) dom.log.scrollTop = dom.log.scrollHeight;
  }

  function replaceLog(entries) {
    logEntries = entries.slice(-HISTORY_LIMIT);
    dom.log.textContent = "";
    logEntries.forEach(renderEntry);
    if (!logEntries.length) renderEmptyState();
    dom.log.scrollTop = dom.log.scrollHeight;
  }

  /* ---------------- turn builder ---------------- */

  // "…" → --option, (…) → --text-now, *…* → --text-old. Every piece is added
  // as text, so markup inside a plan stays inert.
  function paintMarkup(target, text) {
    var pattern = /"[^"]*"|\([^)]*\)|\*[^*]*\*/g;
    var cursor = 0;
    var match;

    while ((match = pattern.exec(text))) {
      if (match.index > cursor) {
        target.appendChild(
          document.createTextNode(text.slice(cursor, match.index)),
        );
      }
      var head = match[0].charAt(0);
      var piece = document.createElement("span");
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

  function renderTurnEmptyState() {
    if (dom.turnLog.children.length) return;
    var placeholder = document.createElement("p");
    placeholder.className = "turn-empty";
    placeholder.textContent = "Nothing planned yet.";
    dom.turnLog.appendChild(placeholder);
  }

  function renderTurn(entry) {
    var placeholder = dom.turnLog.querySelector(".turn-empty");
    if (placeholder) placeholder.remove();

    var slot = String(slotOf(entry.authorId, entry.author));
    var line = document.createElement("p");
    line.className = "turn-line";

    var author = document.createElement("span");
    author.className = "turn-author";
    author.textContent = entry.author;
    author.dataset.slot = slot;
    line.appendChild(author);
    line.appendChild(document.createTextNode(" — "));

    var body = document.createElement("span");
    body.className = "turn-body";
    paintMarkup(body, entry.text);
    line.appendChild(body);

    var wrapper = document.createElement("article");
    wrapper.className = "turn-entry";
    wrapper.dataset.slot = slot;
    wrapper.appendChild(line);

    var pinned =
      dom.turnLog.scrollTop + dom.turnLog.clientHeight >=
      dom.turnLog.scrollHeight - 32;
    dom.turnLog.appendChild(wrapper);
    if (pinned) dom.turnLog.scrollTop = dom.turnLog.scrollHeight;
  }

  function replaceTurnLog(entries) {
    turnEntries = entries.slice(-TURN_LIMIT);
    dom.turnLog.textContent = "";
    turnEntries.forEach(renderTurn);
    if (!turnEntries.length) renderTurnEmptyState();
    dom.turnLog.scrollTop = dom.turnLog.scrollHeight;
  }

  function commitTurn(entry) {
    turnEntries.push(entry);
    if (turnEntries.length > TURN_LIMIT) turnEntries.shift();
    renderTurn(entry);
  }

  /* Import: the planned turns, as plain text, for the administrateur's
     clipboard. Built from turnEntries rather than scraped from the DOM, so
     the copy matches the host's authoritative log exactly. */

  var IMPORT_HEADING = "# Actions planned by players:";

  function turnTranscript() {
    var lines = turnEntries.map(function (entry) {
      return entry.author + " — " + entry.text;
    });
    return IMPORT_HEADING + "\n" + lines.join("\n");
  }

  // execCommand fallback: navigator.clipboard needs a secure context, which a
  // room served over plain http will not have.
  function copyByCarrier(text) {
    var carrier = document.createElement("textarea");
    carrier.value = text;
    carrier.setAttribute("readonly", "readonly");
    carrier.style.position = "fixed";
    carrier.style.top = "-1000px";
    carrier.style.opacity = "0";
    document.body.appendChild(carrier);

    var restore = document.activeElement;
    var ok = false;
    try {
      carrier.select();
      ok = document.execCommand("copy");
    } catch (error) {
      ok = false;
    }
    carrier.remove();
    if (restore && restore.focus) restore.focus();
    return ok;
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(true);
        },
        function () {
          done(copyByCarrier(text));
        },
      );
      return;
    }
    done(copyByCarrier(text));
  }

  function resetImportButton() {
    if (importResetTimer) {
      clearTimeout(importResetTimer);
      importResetTimer = null;
    }
    dom.importButton.textContent = "Import";
  }

  function flashImportButton(label) {
    if (importResetTimer) clearTimeout(importResetTimer);
    dom.importButton.textContent = label;
    importResetTimer = setTimeout(resetImportButton, 1600);
  }

  // The banner is only in the document for the administrateur; the guard is
  // there so nothing else can reach the export either.
  function exportTurns() {
    if (!isAdmin) return;
    copyText(turnTranscript(), function (ok) {
      flashImportButton(ok ? "Copied ✓" : "Copy failed");
    });
  }

  function systemNote(text) {
    renderEntry({ system: true, text: text, at: Date.now() });
  }

  /* ---------------- music deck ---------------- */

  var youtubeReady = false;
  var player = null;
  var audioUnlocked = false;

  window.onYouTubeIframeAPIReady = function () {
    youtubeReady = true;
    if (currentTrack) applyTrack(currentTrack);
  };

  function parseVideoId(input) {
    var value = String(input || "").trim();
    if (!value) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

    var patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /\/embed\/([A-Za-z0-9_-]{11})/,
      /\/shorts\/([A-Za-z0-9_-]{11})/,
      /\/live\/([A-Za-z0-9_-]{11})/,
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var match = value.match(patterns[i]);
      if (match) return match[1];
    }
    return null;
  }

  function trackOffsetSeconds(track) {
    var elapsed = (Date.now() - Number(track.startedAt || Date.now())) / 1000;
    return elapsed > 1 ? Math.floor(elapsed) : 0;
  }

  // Only ever seen by the administrateur: for everyone else the label is not
  // in the document at all.
  function describeTrack() {
    if (!currentTrack) {
      dom.trackLabel.textContent = "Silence.";
      return;
    }
    var title = "";
    if (player && player.getVideoData) {
      try {
        title = (player.getVideoData() || {}).title || "";
      } catch (error) {
        title = "";
      }
    }
    dom.trackLabel.textContent = title || currentTrack.videoId;
  }

  // Everyone hears the music; nobody but the administrateur is shown any part
  // of the deck, so the fallback button is admin-only and other listeners rely
  // on the gesture they already made to get into the room.
  function refreshAudioUnlockButton() {
    dom.audioUnlock.hidden = !(isAdmin && currentTrack && !audioUnlocked);
  }

  function markAudioUnlocked() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    refreshAudioUnlockButton();
    if (player && player.unMute) {
      try {
        player.unMute();
        player.setVolume(45);
        if (currentTrack) player.playVideo();
      } catch (error) {
        /* player not ready yet; applyTrack will honour the flag */
      }
    }
  }

  function applyTrack(track) {
    currentTrack = track || null;
    describeTrack();
    refreshAudioUnlockButton();

    if (!currentTrack) {
      if (player && player.stopVideo) {
        try {
          player.stopVideo();
        } catch (error) {
          /* player tearing down */
        }
      }
      return;
    }
    if (!youtubeReady || typeof YT === "undefined" || !YT.Player) return; // resumes in onYouTubeIframeAPIReady

    var offset = trackOffsetSeconds(currentTrack);

    if (!player) {
      player = new YT.Player("yt-player", {
        width: 1,
        height: 1,
        videoId: currentTrack.videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          playsinline: 1,
          start: offset,
          origin: location.origin,
        },
        events: {
          onReady: function (event) {
            event.target.setVolume(45);
            // Browsers block unmuted autoplay without a gesture, so start muted
            // until the page has seen one.
            if (audioUnlocked) event.target.unMute();
            else event.target.mute();
            event.target.playVideo();
            describeTrack();
          },
          onStateChange: describeTrack,
          onError: function () {
            dom.deckError.textContent = "That video refused to play here.";
          },
        },
      });
      return;
    }

    player.loadVideoById({
      videoId: currentTrack.videoId,
      startSeconds: offset,
    });
    if (audioUnlocked) player.unMute();
    player.playVideo();
  }

  function requestTrack(videoId) {
    if (!isAdmin) return;
    var track = videoId ? { videoId: videoId, startedAt: Date.now() } : null;
    if (isHost) {
      applyTrack(track);
      broadcast({ type: "track", track: track });
      return;
    }
    if (upstream && upstream.open) {
      upstream.send({ type: "track-request", track: track });
      return;
    }
    dom.deckError.textContent = "Not connected.";
  }

  /* ---------------- wire plumbing ---------------- */

  function broadcast(payload, exceptPeerId) {
    downstream.forEach(function (connection, peerId) {
      if (peerId === exceptPeerId || !connection.open) return;
      try {
        connection.send(payload);
      } catch (error) {
        /* connection closing */
      }
    });
  }

  function rosterPayload() {
    var people = [];
    roster.forEach(function (person) {
      people.push(person);
    });
    return { type: "roster", people: people };
  }

  function commit(entry) {
    logEntries.push(entry);
    if (logEntries.length > HISTORY_LIMIT) logEntries.shift();
    renderEntry(entry);
  }

  function shareText(text) {
    if (!isAdmin) return;
    var body = cleanText(text);
    if (!body) return;

    if (isHost) {
      var entry = {
        id: uid(),
        author: profile.name,
        text: body,
        at: Date.now(),
      };
      commit(entry);
      broadcast({ type: "entry", entry: entry });
      return;
    }
    if (upstream && upstream.open) {
      upstream.send({ type: "entry", entry: { text: body } }); // identity stamped downstream
      return;
    }
    systemNote("Not connected — that line went nowhere.");
  }

  // The administrateur narrates; the players declare intent. Enforced again on
  // the host, where the turn log is owned.
  function shareTurn(text) {
    if (isAdmin) return false;
    var body = cleanText(text);
    if (body.length < TURN_MIN_LENGTH) {
      dom.turnError.textContent =
        "A plan needs at least " + TURN_MIN_LENGTH + " characters.";
      return false;
    }
    dom.turnError.textContent = "";

    if (isHost) {
      var entry = {
        id: uid(),
        authorId: selfId,
        author: profile.name,
        text: body,
        at: Date.now(),
      };
      commitTurn(entry);
      broadcast({ type: "turn", turn: entry });
      return true;
    }
    if (upstream && upstream.open) {
      upstream.send({ type: "turn", turn: { text: body } }); // stamped downstream
      return true;
    }
    return false;
  }

  /* ---------------- owner role ---------------- */

  function startHost(generation) {
    var instance = peer;
    isHost = true;
    joinAttempts = 0;
    selfId = instance.id;
    roster.set(selfId, {
      id: selfId,
      name: profile.name,
      portrait: profile.portrait,
      admin: isAdmin,
      slot: isAdmin ? 0 : 1,
      ready: false,
    });

    renderRoster();
    setStatus("online", "Connected");

    instance.on("connection", function (connection) {
      if (!sessionAlive(instance, generation)) {
        try {
          connection.close();
        } catch (error) {
          /* ignore */
        }
        return;
      }

      connection.on("open", function () {
        if (!sessionAlive(instance, generation)) return;
        downstream.set(connection.peer, connection);
      });

      connection.on("data", function (data) {
        if (!sessionAlive(instance, generation)) return;
        if (!data || typeof data.type !== "string") return;
        var person = roster.get(connection.peer);

        if (data.type === "hello") {
          var name = cleanName(data.profile && data.profile.name) || "Unnamed";
          var joiningAdmin = isAdminName(name);
          var previous = roster.get(connection.peer);
          roster.set(connection.peer, {
            id: connection.peer,
            name: name,
            portrait: cleanImageUrl(data.profile && data.profile.portrait),
            admin: joiningAdmin,
            slot: joiningAdmin ? 0 : (previous && previous.slot) || nextSlot(),
            ready: false,
          });

          renderRoster();
          connection.send({
            type: "welcome",
            id: connection.peer,
            entries: logEntries,
            turns: turnEntries,
            track: currentTrack,
            scene: scene,
          });
          connection.send(rosterPayload());
          broadcast(rosterPayload(), connection.peer);
          return;
        }

        if (data.type === "entry") {
          // Speech is an administrateur privilege; enforced here, where the
          // log is owned, not in the sender's UI.
          if (!person || !person.admin) return;
          var body = cleanText(data.entry && data.entry.text);
          if (!body) return;
          var entry = {
            id: uid(),
            author: person.name,
            text: body,
            at: Date.now(),
          };
          commit(entry);
          broadcast({ type: "entry", entry: entry });
          return;
        }

        if (data.type === "turn") {
          if (!person || person.admin) return;
          var plan = cleanText(data.turn && data.turn.text);
          if (plan.length < TURN_MIN_LENGTH) return;
          var planned = {
            id: uid(),
            authorId: person.id,
            author: person.name,
            text: plan,
            at: Date.now(),
          };
          commitTurn(planned);
          broadcast({ type: "turn", turn: planned });
          return;
        }

        if (data.type === "ready") {
          // A player owns their own flag and nothing else.
          if (!person || person.admin) return;
          person.ready = !!data.ready;
          renderRoster();
          broadcast(rosterPayload());
          return;
        }

        if (data.type === "scene-request") {
          // The scene is an administrateur privilege, enforced here where it
          // is owned; the host's copy is the one everybody paints.
          if (!person || !person.admin) return;
          applyScene(data.scene);
          broadcast({ type: "scene", scene: scene });
          return;
        }

        if (data.type === "track-request") {
          if (!person || !person.admin) return;
          var videoId = data.track ? parseVideoId(data.track.videoId) : null;
          var track = videoId
            ? { videoId: videoId, startedAt: Date.now() }
            : null;
          applyTrack(track);
          broadcast({ type: "track", track: track });
        }
      });

      var drop = function () {
        if (!sessionAlive(instance, generation)) return;
        downstream.delete(connection.peer);
        roster.delete(connection.peer);
        renderRoster();
        broadcast(rosterPayload());
      };
      connection.on("close", drop);
      connection.on("error", drop);
    });
  }

  /* ---------------- guest role ---------------- */

  function normalizeEntry(raw) {
    if (!raw || typeof raw.text !== "string") return null;
    var text = cleanText(raw.text);
    if (!text) return null;
    return {
      id: raw.id || uid(),
      author: cleanName(raw.author) || "Unnamed",
      authorId: typeof raw.authorId === "string" ? raw.authorId : "",
      text: text,
      at: Number(raw.at) || Date.now(),
      system: !!raw.system,
    };
  }

  function startGuest(hostId, generation) {
    var instance = peer;
    isHost = false;
    setStatus("connecting", "Knocking…");

    var connection = instance.connect(hostId, { reliable: true });
    upstream = connection;

    var mine = function () {
      return sessionAlive(instance, generation) && connection === upstream;
    };

    connection.on("open", function () {
      if (!mine()) return;
      joinAttempts = 0;
      selfId = instance.id;
      setStatus("online", "Connected");
      connection.send({ type: "hello", profile: profile });
    });

    connection.on("data", function (data) {
      if (!mine()) return;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "welcome") {
        if (typeof data.id === "string") selfId = data.id;
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
        var incoming =
          data.track && parseVideoId(data.track.videoId)
            ? {
                videoId: parseVideoId(data.track.videoId),
                startedAt: Number(data.track.startedAt) || Date.now(),
              }
            : null;
        applyTrack(incoming);
        return;
      }

      if (data.type === "roster" && Array.isArray(data.people)) {
        roster.clear();
        data.people.forEach(function (raw) {
          if (!raw || typeof raw.id !== "string") return;
          var name = cleanName(raw.name) || "Unnamed";
          var slot = Number(raw.slot) || 0;
          if (slot < 0 || slot > PLAYER_SLOTS) slot = 0;
          roster.set(raw.id, {
            id: raw.id,
            name: name,
            portrait: cleanImageUrl(raw.portrait),
            admin: isAdminName(name),
            slot: slot,
            ready: !!raw.ready,
          });
        });
        renderRoster();
        // The host's copy of our flag is the real one.
        var me = roster.get(selfId);
        if (me && !isAdmin && !!me.ready !== selfReady) {
          selfReady = !!me.ready;
          paintReadyButton();
        }
        // Slots may have only just arrived; repaint the plans in their colours.
        replaceTurnLog(turnEntries);
        return;
      }

      if (data.type === "entry") {
        var entry = normalizeEntry(data.entry);
        if (entry) commit(entry);
        return;
      }

      if (data.type === "turn") {
        var planned = normalizeEntry(data.turn);
        if (planned) commitTurn(planned);
        return;
      }

      if (data.type === "scene") {
        applyScene(data.scene);
        return;
      }

      if (data.type === "track") {
        var videoId = data.track ? parseVideoId(data.track.videoId) : null;
        applyTrack(
          videoId
            ? {
                videoId: videoId,
                startedAt: Number(data.track.startedAt) || Date.now(),
              }
            : null,
        );
      }
    });

    connection.on("close", function () {
      if (!mine()) return; // silent when we are the ones walking out
      setStatus("error", "Disconnected");
      roster.clear();
      renderRoster();
      systemNote("The room closed. Rejoin to reopen it.");
    });

    connection.on("error", function () {
      if (!mine()) return;
      setStatus("error", "Connection error");
    });
  }

  /* ---------------- lifecycle ---------------- */

  function retryJoin(generation) {
    if (generation !== sessionGeneration) return;

    var stale = peer;
    peer = null;
    destroyPeer(stale);

    if (joinAttempts >= MAX_JOIN_ATTEMPTS) {
      setStatus("error", "Unreachable");
      systemNote("Nobody answered here. Leave and rejoin to try again.");
      return;
    }

    joinAttempts += 1;
    setStatus("connecting", "The room is settling… retrying");
    setTimeout(function () {
      openRoom(generation);
    }, RETRY_DELAY_MS);
  }

  function bindReconnect(instance, generation) {
    instance.on("disconnected", function () {
      if (!sessionAlive(instance, generation) || instance.destroyed) return;
      setStatus("connecting", "Reconnecting…");
      try {
        instance.reconnect();
      } catch (error) {
        /* already torn down */
      }
    });
  }

  function swapToGuest(hostId, generation) {
    var stale = peer;
    peer = null;
    destroyPeer(stale);
    if (generation !== sessionGeneration) return;

    var instance = new Peer({ debug: 1 });
    peer = instance;

    instance.on("open", function () {
      if (!sessionAlive(instance, generation)) return;
      startGuest(hostId, generation);
    });

    instance.on("error", function (error) {
      if (!sessionAlive(instance, generation)) return;
      var type = error && error.type;
      if (type === "peer-unavailable") {
        // The code is registered but nobody answers: usually a room that just
        // emptied and whose broker entry has not expired yet. Try to claim it.
        retryJoin(generation);
        return;
      }
      setStatus("error", "Network error");
      systemNote("Signalling error: " + (type || "unknown"));
    });

    bindReconnect(instance, generation);
  }

  // Attempt to claim the room; fall back to joining if it is already held.
  function openRoom(generation) {
    if (generation !== sessionGeneration) return;

    upstream = null;
    downstream.clear();
    isHost = false;

    var hostId = ROOM_PREFIX + roomId;
    var instance = new Peer(hostId, { debug: 1 });
    peer = instance;

    instance.on("open", function () {
      if (!sessionAlive(instance, generation)) return;
      startHost(generation);
    });

    instance.on("error", function (error) {
      if (!sessionAlive(instance, generation)) return;
      if (error && error.type === "unavailable-id") {
        swapToGuest(hostId, generation);
        return;
      }
      setStatus("error", "Network error");
      systemNote("Signalling error: " + ((error && error.type) || "unknown"));
    });

    bindReconnect(instance, generation);
  }

  function connect(room, name, portrait) {
    sessionGeneration += 1;
    joinAttempts = 0;

    roomId = room;
    profile = { name: name, portrait: portrait };
    isAdmin = isAdminName(name);

    // The badge names a privilege, so it exists only where there is one.
    dom.roleLabel.hidden = !isAdmin;

    // Players get no deck, no composer and no scene controls: they read the
    // log, look at the scene, hear the music, and plan their turn. The
    // administrateur gets the reverse, and no character sheet either.
    setPresent(deckAnchor, dom.deck, isAdmin);
    setPresent(composerAnchor, dom.composer, isAdmin);
    setPresent(sceneToolsAnchor, dom.sceneTools, isAdmin);
    setPresent(turnComposerAnchor, dom.turnComposer, !isAdmin);
    setPresent(panelFootAnchor, dom.panelFoot, !isAdmin);
    setPresent(readyBannerAnchor, dom.readyBanner, isAdmin);

    dom.joinPanel.hidden = true;
    dom.sessionPanel.hidden = false;

    setStatus("connecting", "Finding the room…");
    roster.clear();
    renderRoster();
    replaceLog([]);
    replaceTurnLog([]);
    selfReady = false;
    paintReadyButton();
    dom.turnError.textContent = "";

    applyScene({ image: null });
    sheetState = isAdmin ? null : DiscoSkillSheet.normalize(stagedSheet);
    if (sheet) sheet.setState(sheetState, true);
    refreshVitals(true);
    describeTrack();
    refreshAudioUnlockButton();

    if (location.hash.slice(1) !== roomId) location.hash = roomId;

    openRoom(sessionGeneration);
    if (isAdmin) dom.textInput.focus();
    else dom.turnInput.focus();
  }

  function leave() {
    sessionGeneration += 1; // invalidate every handler from this session
    joinAttempts = 0;

    var stale = peer;
    peer = null; // null first, so nothing can revive it
    destroyPeer(stale);

    if (player && player.stopVideo) {
      try {
        player.stopVideo();
      } catch (error) {
        /* ignore */
      }
    }

    closePortrait();
    closePsyche();
    sheetState = null;
    stagedSheet = null;
    if (sheet) sheet.setState(null, true);

    upstream = null;
    downstream.clear();
    roster.clear();
    logEntries = [];
    turnEntries = [];
    currentTrack = null;
    isHost = false;
    isAdmin = false;
    selfId = null;

    dom.sessionPanel.hidden = true;
    dom.joinPanel.hidden = false;
    dom.log.textContent = "";
    dom.textInput.value = "";
    dom.turnLog.textContent = "";
    dom.turnInput.value = "";
    dom.turnError.textContent = "";

    selfReady = false;
    paintReadyButton();
    resetImportButton();

    dom.deckError.textContent = "";
    dom.sceneError.textContent = "";
    dom.sceneImageInput.value = "";
    dom.sceneImageUrl.value = "";
    dom.audioUnlock.hidden = true;
    dom.trackLabel.textContent = "Silence.";
    dom.roleLabel.hidden = true;
    setPresent(deckAnchor, dom.deck, false);
    setPresent(composerAnchor, dom.composer, false);
    setPresent(sceneToolsAnchor, dom.sceneTools, false);
    setPresent(turnComposerAnchor, dom.turnComposer, false);
    setPresent(panelFootAnchor, dom.panelFoot, false);
    setPresent(readyBannerAnchor, dom.readyBanner, false);

    dom.statsInput.value = "";
    refreshVitals(true);
    renderTurnEmptyState();
    applyScene({ image: null });
    setStatus("offline", "Offline");
    dom.nameInput.focus();
  }

  // Every async handler is stamped with the peer it belongs to and the session
  // generation it was created in. Anything from an abandoned session is ignored.
  function sessionAlive(instance, generation) {
    return generation === sessionGeneration && instance === peer;
  }

  // Strip our listeners before tearing down. PeerJS emits 'disconnected' from
  // inside destroy() while destroyed is still false, so leaving the old handler
  // attached makes it call reconnect() and resurrect the socket — which then
  // holds the room code on the broker and blocks every later rejoin.
  function destroyPeer(instance) {
    if (!instance) return;
    try {
      instance.removeAllListeners();
    } catch (error) {
      /* already gone */
    }
    try {
      instance.destroy();
    } catch (error) {
      /* already gone */
    }
  }

  /* ---------------- events ---------------- */

  function paintPreview() {
    paintThumb(dom.portraitPreview, {
      name: cleanName(dom.nameInput.value),
      portrait: stagedPortrait,
    });
  }

  dom.portraitInput.addEventListener("change", function () {
    var file = dom.portraitInput.files && dom.portraitInput.files[0];
    dom.joinError.textContent = "";
    if (!file) return;

    var rejection = rejectImageFile(file);
    if (rejection) {
      dom.portraitInput.value = "";
      dom.joinError.textContent = rejection;
      return;
    }

    dom.joinError.textContent = "Uploading the portrait…";
    dom.joinButton.disabled = true;
    uploadImage(file, function (url, error) {
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

  dom.portraitUrl.addEventListener("change", function () {
    dom.joinError.textContent = "";
    var raw = dom.portraitUrl.value.trim();
    if (!raw) {
      stagedPortrait = null;
      paintPreview();
      return;
    }

    var url = cleanImageUrl(raw);
    if (!url) {
      dom.joinError.textContent = "Use a full https image address.";
      return;
    }

    dom.joinError.textContent = "Checking that address…";
    probeImage(url, function (ok) {
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

  // A stats file only seeds this player's own sheet; it is normalised through
  // the sheet's own merge, so unknown or out-of-range values cannot survive.
  dom.statsInput.addEventListener("change", function () {
    var file = dom.statsInput.files && dom.statsInput.files[0];
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

    var reader = new FileReader();
    reader.onerror = function () {
      dom.statsInput.value = "";
      stagedSheet = null;
      dom.joinError.textContent = "That file could not be read.";
    };
    reader.onload = function () {
      var parsed;
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
      stagedSheet = DiscoSkillSheet.normalize(parsed);
      dom.joinError.textContent = "Stats loaded.";
    };
    reader.readAsText(file);
  });

  dom.nameInput.addEventListener("input", function () {
    if (!stagedPortrait) paintPreview();
  });

  dom.joinForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = cleanName(dom.nameInput.value);

    if (!name) {
      dom.joinError.textContent = "Your character needs a name.";
      return;
    }

    // A link decides the room; otherwise this visit mints a fresh code.
    var room = roomFromHash() || randomRoomCode();

    dom.joinError.textContent = "";
    dom.joinButton.disabled = true;
    connect(room, name, stagedPortrait);
    dom.joinButton.disabled = false;
  });

  dom.composer.addEventListener("submit", function (event) {
    event.preventDefault();
    shareText(dom.textInput.value);
    dom.textInput.value = "";
    dom.textInput.focus();
  });

  dom.textInput.addEventListener("keydown", function (event) {
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

  /* turn builder: the players' side of the table */

  dom.turnComposer.addEventListener("submit", function (event) {
    event.preventDefault();
    if (shareTurn(dom.turnInput.value)) dom.turnInput.value = "";
    dom.turnInput.focus();
  });

  dom.turnInput.addEventListener("input", function () {
    dom.turnError.textContent = "";
  });

  dom.turnInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (dom.turnComposer.requestSubmit) {
        dom.turnComposer.requestSubmit();
      } else if (shareTurn(dom.turnInput.value)) {
        dom.turnInput.value = "";
      }
    }
  });

  dom.turnReady.addEventListener("click", function () {
    setSelfReady(!selfReady);
  });

  dom.importButton.addEventListener("click", exportTurns);

  /* scene: viewable by everyone, editable by the administrateur alone */

  dom.sceneThumb.addEventListener("click", openScene);

  dom.sceneImageInput.addEventListener("change", function () {
    var file = dom.sceneImageInput.files && dom.sceneImageInput.files[0];
    dom.sceneError.textContent = "";
    if (!file) return;

    var rejection = rejectImageFile(file);
    if (rejection) {
      dom.sceneImageInput.value = "";
      dom.sceneError.textContent = rejection;
      return;
    }

    dom.sceneError.textContent = "Uploading…";
    uploadImage(file, function (url, error) {
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

  dom.sceneImageUrl.addEventListener("change", function () {
    dom.sceneError.textContent = "";
    var raw = dom.sceneImageUrl.value.trim();
    if (!raw) {
      pushScene({ image: null });
      return;
    }

    var url = cleanImageUrl(raw);
    if (!url) {
      dom.sceneError.textContent = "Use a full https image address.";
      return;
    }

    dom.sceneError.textContent = "Checking…";
    probeImage(url, function (ok) {
      if (!ok) {
        dom.sceneError.textContent = "That address did not load.";
        return;
      }
      dom.sceneError.textContent = "";
      dom.sceneImageUrl.value = url;
      pushScene({ name: scene.name, image: url });
    });
  });

  dom.trackPlay.addEventListener("click", function () {
    dom.deckError.textContent = "";
    var videoId = parseVideoId(dom.trackUrl.value);
    if (!videoId) {
      dom.deckError.textContent = "That does not look like a YouTube link.";
      return;
    }
    markAudioUnlocked(); // this click is the gesture
    requestTrack(videoId);
    dom.trackUrl.value = "";
  });

  dom.trackStop.addEventListener("click", function () {
    dom.deckError.textContent = "";
    requestTrack(null);
  });

  dom.audioUnlock.addEventListener("click", function () {
    markAudioUnlocked();
    dom.audioUnlock.hidden = true;
    if (player) {
      if (currentTrack) player.seekTo(trackOffsetSeconds(currentTrack), true);
    } else if (currentTrack) {
      applyTrack(currentTrack);
    }
  });

  // Listeners without a deck still need a gesture on record before the browser
  // will let the hidden player run unmuted; their first interaction supplies it.
  document.addEventListener("pointerdown", markAudioUnlocked, {
    capture: true,
    once: true,
  });
  document.addEventListener("keydown", markAudioUnlocked, {
    capture: true,
    once: true,
  });

  dom.roster.addEventListener("click", function (event) {
    var target = event.target.closest(".roster-person");
    if (!target || !target.dataset.personId) return;
    openPortrait(target.dataset.personId);
  });

  dom.modalClose.addEventListener("click", closePortrait);

  dom.modal.addEventListener("click", function (event) {
    if (event.target.dataset.close === "true") closePortrait();
  });

  dom.psycheButton.addEventListener("click", openPsyche);
  dom.psycheClose.addEventListener("click", closePsyche);

  dom.psycheModal.addEventListener("click", function (event) {
    if (event.target.dataset.close === "true") closePsyche();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closePsyche();
    closePortrait();
  });

  dom.leaveButton.addEventListener("click", leave);

  window.addEventListener("beforeunload", function () {
    sessionGeneration += 1;
    var stale = peer;
    peer = null;
    destroyPeer(stale);
  });

  (function bootstrap() {
    refreshVitals(true);
    renderScene();
    renderTurnEmptyState();
    paintReadyButton();
    dom.nameInput.focus();
    setStatus("offline", "Offline");
  })();
})();
