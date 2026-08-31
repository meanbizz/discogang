import {
  HISTORY_LIMIT,
  TURN_LIMIT,
  TURN_MIN_LENGTH,
  STATS_MAX_BYTES,
  PLAYER_SLOTS,
  DIALOGUE_ROUND_LIMIT,
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
  paintMarkup,
} from "./utils.js";
import { rejectImageFile, uploadImage, probeImage } from "./upload.js";
import * as audio from "./audio.js";
import * as vitals from "./vitals.js";
import * as modals from "./modals.js";
import * as dialogue from "./dialogue.js";
import * as cues from "./cues.js";
import * as session from "./session.js";
import { applyTiming } from "./timing.js";
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
let sceneOverride = null; // skill art shown while a dialogue node is speaking
let stagedPortrait = null;
let stagedSheet = null;
let sheetState = null;
let importResetTimer = null;
let dialoguePayload = null;
/* Every round sent this session, oldest first — the dialogue history a save
   is written from. */
let dialogueRounds = [];
let dialogueLive = false;
/* A save is read once per session, into an untouched room. This is what
   remembers that it happened. */
let sessionRestored = false;

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
    roster.set(selfId, Object.assign({ done: false }, hostProfile));
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
        done: false,
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
        dialogue: dialoguePayload,
        rounds: dialogueRounds,
        /* A round on record is not the same as a scene in progress. After a
           restore this is false, and a joining player reads the history
           instead of having it played at them. */
        live: dialogueLive,
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

    if (data.type === "dialogue-done") {
      if (!person || person.admin) return;
      person.done = true;
      renderRoster();
      network.broadcast(rosterPayload());

      return;
    }

    if (data.type === "dialogue") {
      if (!person?.admin) return;

      const payload = dialogue.cleanPayload(data.payload);
      if (!payload) return;

      openDialogueRound(payload, data.roundId, data.at);

      return;
    }

    if (data.type === "session-load") {
      if (!person?.admin) return;

      const loaded = session.clean(data.session);
      if (!loaded) return;

      applySession(loaded);
      /* The administrateur applied it before sending it. */
      network.broadcast({ type: "session", session: loaded }, connection.peer);
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

      /* The history comes first: the log is about to be rebuilt from entries
         that may name these rounds, and a marker can only offer its payload
         if the round it names is already in hand. */
      replaceRounds(data.rounds, data.dialogue);

      /* The room says which of the two kinds of payload this is. A live one
         is the scene being played right now and is handed to the reader; a
         round merely on record — the state a restored session is in — is read
         back as transcript along with everything before it. */
      const current = dialogue.cleanPayload(data.dialogue);
      const live = Boolean(data.live) && Boolean(current);

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

      if (dialogueRounds.length) {
        showDialogueHistory(
          live ? dialogueRounds.slice(0, -1) : dialogueRounds,
          "on record",
        );
      }

      if (live) {
        applyDialogue(current);
      } else {
        dialoguePayload = current || session.latestPayload(dialogueRounds);
        dialogueLive = false;
        dialogue.reset();
        refreshPlanningLock();
      }

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
          done: Boolean(raw.done),
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

    if (data.type === "dialogue") {
      const payload = dialogue.cleanPayload(data.payload);

      rememberRound(payload, data.roundId, data.at);
      applyDialogue(payload);

      return;
    }

    if (data.type === "turns") {
      replaceTurnLog(
        (Array.isArray(data.turns) ? data.turns : [])

          .map(normalizeEntry)

          .filter(Boolean),
      );

      return;
    }

    if (data.type === "session") {
      const loaded = session.clean(data.session);
      if (loaded) applySession(loaded);
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
    /* Plans from a scene that has already played out stay faded. */
    stale: Boolean(raw.stale),
    /* Set on the last plan of a round as that round closes — the rule in the
       plan log falls under it. */
    roundEnd: Boolean(raw.roundEnd),
    /* A restored round's marker keeps the round's name wherever it travels,
       so no peer writes the same marker twice. */
    roundId: typeof raw.roundId === "string" ? raw.roundId.slice(0, 64) : "",
  };
}

/* ---------------- Rendering Functions ---------------- */

function renderRoster() {
  dom.roster.textContent = "";
  renderReadyBanner();
  refreshPlanningLock();

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

function countReady() {
  let players = 0;
  let readied = 0;
  roster.forEach((person) => {
    if (person.admin) return;
    players += 1;
    if (person.ready) readied += 1;
  });
  return { players, readied };
}

function everyoneReady() {
  const tally = countReady();
  return tally.players > 0 && tally.readied === tally.players;
}

function renderReadyBanner() {
  dom.readyBanner.hidden = !(isAdmin && everyoneReady());
  refreshSpeakLock();
}

/* The administrateur stays mute until every player has readied up. */
function refreshSpeakLock() {
  const locked = isAdmin && !everyoneReady();

  if (dom.textInput) dom.textInput.disabled = locked;
  if (dom.sendButton) dom.sendButton.disabled = locked;
  if (dom.composer) dom.composer.classList.toggle("is-locked", locked);

  if (!dom.composerLock) return;

  if (!locked) {
    dom.composerLock.hidden = true;
    dom.composerLock.textContent = "";
    return;
  }

  const tally = countReady();
  dom.composerLock.hidden = false;
  dom.composerLock.textContent = tally.players
    ? `Waiting on the players — ${tally.readied} of ${tally.players} ready.`
    : "Waiting for players to join.";
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

/* Lifts a raw payload back out of the log. */
function rawCopyButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entry-copy";
  button.textContent = "Copy";
  button.title = "Copy this payload";
  button.setAttribute("aria-label", "Copy this payload");

  let resetTimer = null;
  button.addEventListener("click", () => {
    copyText(text, (ok) => {
      button.textContent = ok ? "Copied ✓" : "Failed";
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    });
  });

  return button;
}

function renderEntry(entry) {
  const placeholder = dom.log.querySelector(".log-empty");
  if (placeholder) placeholder.remove();

  const previous = dom.log.querySelector(".entry.current");
  if (previous) previous.classList.remove("current");

  const wrapper = document.createElement("article");
  wrapper.className = "entry current";
  if (entry.system) wrapper.classList.add("system");

  if (entry.raw) {
    wrapper.classList.add("raw");
    const label = document.createElement("p");
    label.className = "entry-label";
    label.textContent = "Turn payload sent";
    wrapper.appendChild(label);
    wrapper.appendChild(rawCopyButton(entry.text));
  }

  /* A restored round is one short line in the log; the payload itself stays
     in dialogueRounds, reachable through the copy button rather than sitting
     in an entry where cleanText would truncate it. */
  if (entry.roundId && isAdmin) {
    const held = dialogueRounds.find((round) => round.id === entry.roundId);
    if (held) {
      wrapper.classList.add("raw");
      wrapper.appendChild(rawCopyButton(JSON.stringify(held.payload, null, 2)));
    }
  }

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
  if (entry.stale) wrapper.dataset.stale = "true";
  if (entry.roundEnd) wrapper.dataset.roundEnd = "true";

  wrapper.appendChild(line);

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

/* ---------------- Dialogue Rounds ---------------- */

dialogue.setHooks({
  onFinish: () => {
    reportDialogueDone();

    refreshPlanningLock();
  },

  /* The reader hands over a skill's card art, or null to fall back to the
     administrateur's scene image. */
  onSkillArt: (url) => {
    sceneOverride = url || null;
    renderScene();
  },
});

/* ---------------- Dialogue history ---------------- */

/* Rounds are named where they are written and keep that name everywhere they
   travel, which is what makes this safe to call more than once for the same
   round: the host broadcasts a round back to the administrateur that sent it,
   and an unnamed round would land in the list twice. */
function rememberRound(payload, roundId, at) {
  if (!payload) return null;

  const id =
    typeof roundId === "string" && roundId ? roundId.slice(0, 64) : uid();
  for (let i = 0; i < dialogueRounds.length; i += 1) {
    if (dialogueRounds[i].id === id) return dialogueRounds[i];
  }

  const round = { id, at: Number(at) || Date.now(), payload };
  dialogueRounds.push(round);
  while (dialogueRounds.length > DIALOGUE_ROUND_LIMIT) dialogueRounds.shift();
  /* The room has moved on; a save cannot be dropped over it now. */
  refreshLoadButton();
  return round;
}

/* A history handed over wholesale — from a welcome, or from a save. */
function replaceRounds(rounds, fallbackPayload) {
  dialogueRounds = session.cleanRounds(rounds, fallbackPayload || null);
}

/* Rounds that are already over, put back where they can be used.

   Each one leaves a real log entry — committed, not just painted — so it
   travels to a joining player through the ordinary welcome, survives a log
   rebuild, and lands in the next save. The entry carries the round's name,
   which is what stops a second pass writing it twice: markers already in the
   log are left alone.

   Under each marker, a player gets that round's scene as transcript: nothing
   to press, no cues, no vitals spent twice. The administrateur gets the
   payload on the marker's copy button instead, so any round of the run can be
   sent again rather than only the last.

   note is what the markers call themselves: "restored" from a save, "on
   record" from a welcome. */
function showDialogueHistory(rounds, note) {
  if (!Array.isArray(rounds) || !rounds.length) return;

  const already = new Set();
  logEntries.forEach((entry) => {
    if (entry.roundId) already.add(entry.roundId);
  });

  let scenes = 0;
  let mine = 0;

  rounds.forEach((round, index) => {
    if (!round || !round.payload) return;

    if (isAdmin) return;

    if (dialogue.hasTreeFor(round, network.selfId, profile.name)) mine += 1;
    scenes += dialogue.renderRound(round, network.selfId, profile.name);
  });

  /* A save records trees by character name; the peer ids in it are long dead.
     A player the save never knew therefore has nothing to read, and is told
     so rather than left staring at a bare list of rounds. */
  if (!isAdmin && !mine) {
    systemNote(
      "No scene in this history was written for " +
        (profile.name || "you") +
        " — the rounds above are the table's, not yours.",
    );
    return;
  }
  if (!isAdmin && !scenes) {
    systemNote("Those rounds hold no readable lines for you.");
  }
}

function countScene() {
  let players = 0;
  let done = 0;

  roster.forEach((person) => {
    if (person.admin) return;

    players += 1;

    if (person.done) done += 1;
  });

  return { players, done };
}

function planningUnlocked() {
  if (!dialogueLive) return true;

  const tally = countScene();

  return tally.players > 0 && tally.done === tally.players;
}

function refreshPlanningLock() {
  const locked = !planningUnlocked();

  if (dom.turnInput) dom.turnInput.disabled = locked;

  if (dom.turnSend) dom.turnSend.disabled = locked;

  if (dom.turnReady) dom.turnReady.disabled = locked;

  if (dom.turnComposer) dom.turnComposer.classList.toggle("is-locked", locked);

  if (!dom.turnLock) return;

  if (!locked) {
    dom.turnLock.hidden = true;

    dom.turnLock.textContent = "";

    return;
  }

  const tally = countScene();

  dom.turnLock.hidden = false;
  dom.turnLock.textContent = !dialogue.isFinished()
    ? "Read your scene to its end before planning."
    : `Waiting on the others — ${tally.done} of ${tally.players} have finished the scene.`;
}

function reportDialogueDone() {
  if (isAdmin) return;

  if (network.isHost) {
    const me = roster.get(network.selfId);

    if (me) me.done = true;

    renderRoster();
    network.broadcast(rosterPayload());

    return;
  }

  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "dialogue-done" });
  }
}

/* Everyone's side of a new round: keep the payload, run my own tree. */

function applyDialogue(payload) {
  dialoguePayload = payload || null;

  dialogueLive = Boolean(dialoguePayload);

  if (!dialogueLive) {
    dialogue.reset();

    refreshPlanningLock();

    return;
  }

  if (isAdmin) {
    dialogue.reset();

    refreshPlanningLock();

    return;
  }

  const mine = dialogue.pickTree(dialoguePayload, network.selfId, profile.name);

  if (!mine) {
    dialogue.reset();

    systemNote("No scene was written for you this round.");
    reportDialogueDone();
    refreshPlanningLock();

    return;
  }

  dialogue.start(mine);
  refreshPlanningLock();
}

/* A new scene no longer clears the board. The standing plans simply recede,
   so the table can still read what was planned last round — and the round
   after that. TURN_LIMIT is what prunes them now, nothing else.

   The last plan of the round being closed is also where the rule between
   rounds goes. A round nobody planned for closes without one, so two quiet
   rounds in a row cannot stack two rules on the same entry. */
function ageTurnLog() {
  let touched = false;
  let last = null;

  turnEntries.forEach((entry) => {
    if (!entry.stale) {
      entry.stale = true;
      last = entry;
      touched = true;
    }
  });

  if (last && !last.roundEnd) {
    last.roundEnd = true;
    touched = true;
  }

  if (touched) replaceTurnLog(turnEntries);
}

/* Host only: a payload arrived, so the round restarts — plans age, ready and
   finished flags drop, and everybody gets the trees. The round joins the
   history here, under the name it was published with. */

function openDialogueRound(payload, roundId, at) {
  const round = rememberRound(payload, roundId, at);

  roster.forEach((person) => {
    if (person.admin) return;

    person.done = false;
    person.ready = false;
  });

  if (!isAdmin) {
    selfReady = false;

    paintReadyButton();
  }

  ageTurnLog();

  network.broadcast({ type: "turns", turns: turnEntries });
  network.broadcast({
    type: "dialogue",
    payload,
    roundId: round ? round.id : null,
    at: round ? round.at : null,
  });

  applyDialogue(payload);
  renderRoster();

  network.broadcast(rosterPayload());
}

/* Administrateur only: echo the raw payload locally, then push it out.

   The round is named here, where it was written, and keeps that name through
   the host and back again — so the copy the host broadcasts to everyone,
   this desk included, is recognised as the round already held. */

function publishDialogue(payload, raw) {
  renderEntry({ text: raw, at: Date.now(), raw: true });

  const roundId = uid();
  const at = Date.now();

  if (network.isHost) {
    openDialogueRound(payload, roundId, at);

    return;
  }

  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "dialogue", payload, roundId, at });

    rememberRound(payload, roundId, at);

    dialoguePayload = payload;

    dialogueLive = true;

    refreshPlanningLock();

    return;
  }

  systemNote("Not connected — that payload went nowhere.");
}

/* ---------------- Scene & NPCs ---------------- */

function renderScene() {
  if (dom.sceneThumb)
    paintThumb(dom.sceneThumb, { portrait: sceneOverride || scene.image });
}

function applyScene(next) {
  scene = cleanScene(next);
  renderScene();
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
  if (!planningUnlocked()) return;

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
  if (!everyoneReady()) {
    systemNote("Not everybody is ready. Nothing leaves this desk yet.");
    return;
  }

  const attempt = dialogue.parsePayload(text);
  if (attempt.payload) {
    publishDialogue(attempt.payload, attempt.raw);

    return;
  }

  if (attempt.error) {
    systemNote(attempt.error);

    return;
  }

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
  if (!planningUnlocked()) {
    dom.turnError.textContent = "The scene is still playing out.";
    return false;
  }

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

  /* Only what was planned for the round in progress. Anything stale belongs
     to a scene that has already played out — or to a restored save — and was
     imported once already; sending it again would hand the same plans to the
     writer twice. */
  const fresh = turnEntries.filter((entry) => !entry.stale);

  if (importResetTimer) clearTimeout(importResetTimer);

  if (!fresh.length) {
    dom.importButton.textContent = "Nothing new";
    importResetTimer = setTimeout(() => {
      dom.importButton.textContent = "Import";
    }, 1600);
    return;
  }

  const lines = fresh.map((e) => `${e.author} — ${e.text}`);
  const transcript = `# Actions planned by players:\n${lines.join("\n")}`;
  copyText(transcript, (ok) => {
    if (importResetTimer) clearTimeout(importResetTimer);
    dom.importButton.textContent = ok ? "Copied ✓" : "Copy failed";
    importResetTimer = setTimeout(() => {
      dom.importButton.textContent = "Import";
    }, 1600);
  });
}

/* ---------------- Session Save & Load ---------------- */

let sessionNoteTimer = null;

function noteSession(text) {
  if (!dom.sessionNote) return;
  dom.sessionNote.textContent = text;
  if (sessionNoteTimer) clearTimeout(sessionNoteTimer);
  sessionNoteTimer = setTimeout(() => {
    dom.sessionNote.textContent = "";
  }, 4000);
}

/* Load is a first move, not a command.

   A save replaces the room wholesale and holds no record of who had already
   read what, so it is only ever read into a room that has not started: no
   round sent, no save read. Once either has happened the button stays shut for
   the rest of the session, and leaving and rejoining is what reopens it. */
function loadAllowed() {
  return isAdmin && !sessionRestored && !dialogueRounds.length;
}

/* Paints the button only — the click path and loadSession both check for
   themselves. */
function refreshLoadButton() {
  if (!dom.sessionLoad) return;

  const allowed = loadAllowed();
  dom.sessionLoad.disabled = !allowed;
  dom.sessionLoad.dataset.locked = allowed ? "false" : "true";
  dom.sessionLoad.setAttribute("aria-disabled", allowed ? "false" : "true");
  dom.sessionLoad.title = allowed
    ? "Restore a session from a .json save"
    : sessionRestored
      ? "A save has already been read this session."
      : "The room has started — a save only loads into an untouched room.";
}

function exportSession() {
  if (!isAdmin) return;

  const people = [];
  roster.forEach((person) => people.push(person));

  const snap = session.snapshot({
    room: roomId,
    people,
    entries: logEntries,
    turns: turnEntries,
    npcs,
    scene,
    dialogue: dialoguePayload,
    rounds: dialogueRounds,
  });

  noteSession(
    session.download(snap)
      ? "Session written to a save file."
      : "That save could not be written.",
  );
}

/* Returning players get their old colour back by name — the peer ids in a
   save are long dead, the names usually are not. Host only: slots are the
   host's to hand out. */
function restoreSlots(people) {
  if (!network.isHost || !Array.isArray(people) || !people.length) return;

  let touched = false;
  people.forEach((saved) => {
    if (saved.admin || !saved.slot) return;
    roster.forEach((person) => {
      if (person.admin || person.name !== saved.name) return;
      if (person.slot === saved.slot) return;
      person.slot = saved.slot;
      touched = true;
    });
  });

  if (!touched) return;
  renderRoster();
  network.broadcast(rosterPayload());
}

/* Every plan in a save belongs to a round that is already over, whichever
   round was live when the file was written. They come back faded so the next
   Import cannot pick them up, and the last of them carries the rule that
   separates the restored run from whatever is planned next. Boundaries
   already inside the save are left where they are. */
function restoredTurns(entries) {
  entries.forEach((entry) => {
    entry.stale = true;
  });
  const last = entries[entries.length - 1];
  if (last) last.roundEnd = true;
  return entries;
}

/* Everyone's side of a restore. It only ever lands in a room where nothing
   has happened yet, so the whole run is written into a clean log: one entry
   per round for the table, the administrateur's payloads on their copy
   buttons, each player's own scenes as transcript underneath. Those entries
   are real, so a player joining later receives them in the ordinary welcome
   and the next Export carries the sessions before this one as well as this
   one.

   Nothing replays. The reader stays closed and planning stays open, since a
   save holds no record of who had already read their scene to the end — which
   is also why this may only happen once. */
function applySession(snap) {
  if (!snap) return;

  replaceRounds(snap.rounds, snap.dialogue);
  /* The last round held is the current one, so "current" and the history
     below can never disagree. */
  dialoguePayload =
    session.latestPayload(dialogueRounds) || snap.dialogue || null;
  dialogueLive = false;
  dialogue.reset();

  replaceLog((snap.entries || []).map(normalizeEntry).filter(Boolean));
  replaceTurnLog(
    restoredTurns((snap.turns || []).map(normalizeEntry).filter(Boolean)),
  );
  setNpcs(snap.npcs);

  applyScene(snap.scene);

  showDialogueHistory(dialogueRounds, "restored");
  sessionRestored = true;

  restoreSlots(snap.people);
  renderRoster();
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();
}

/* Administrateur only: apply it here, then push it to the table. */
function loadSession(snap) {
  if (!isAdmin || !snap) return;
  if (!loadAllowed()) {
    refreshLoadButton();
    noteSession(
      "A save only loads into an untouched room. Leave and rejoin to read one.",
    );
    return;
  }

  applySession(snap);

  if (network.isHost) {
    network.broadcast({ type: "session", session: snap });
    noteSession("Session restored for the table.");
    return;
  }
  if (network.upstream && network.upstream.open) {
    network.upstream.send({ type: "session-load", session: snap });
    noteSession("Session restored for the table.");
    return;
  }
  noteSession("Restored here only — nothing was sent.");
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
  setPresent(anchors.stageSide, dom.stageSide, !isAdmin);
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

  dialoguePayload = null;
  dialogueRounds = [];
  dialogueLive = false;
  sessionRestored = false;
  dialogue.reset();
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();

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

  dialogue.reset();
  dialoguePayload = null;
  dialogueRounds = [];
  dialogueLive = false;
  sessionRestored = false;

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
  if (dom.sessionNote) dom.sessionNote.textContent = "";
  if (dom.sessionFile) dom.sessionFile.value = "";

  if (dom.audioUnlock) dom.audioUnlock.hidden = true;
  if (dom.trackLabel) dom.trackLabel.textContent = "Silence.";
  dom.roleLabel.hidden = true;

  setPresent(anchors.deck, dom.deck, false);
  setPresent(anchors.adminTools, dom.adminTools, false);
  setPresent(anchors.composer, dom.composer, false);
  setPresent(anchors.stageSide, dom.stageSide, false);
  setPresent(anchors.turnComposer, dom.turnComposer, false);
  setPresent(anchors.panelFoot, dom.panelFoot, false);
  setPresent(anchors.readyBanner, dom.readyBanner, false);

  dom.statsInput.value = "";
  vitals.refreshVitals(null, true);
  renderTurnEmptyState();
  applyScene({ image: null });
  setStatus("offline", "Offline");
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();
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

if (dom.sessionExport) {
  dom.sessionExport.addEventListener("click", exportSession);
}

/* The file input is hidden; Load is what the administrateur actually presses.
   It is a first move only — loadAllowed decides whether the picker opens at
   all. */
if (dom.sessionLoad && dom.sessionFile) {
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
    session.readFile(file, (snap, error) => {
      dom.sessionFile.value = "";
      if (error) {
        noteSession(error);
        return;
      }
      loadSession(snap);
    });
  });
}

if (dom.sceneThumb) {
  dom.sceneThumb.addEventListener("click", () =>
    modals.openImage("Scene", sceneOverride || scene.image, ""),
  );
}

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
  /* Timings onto :root first, so the stylesheet and the JS timers agree from
     the very first frame. */
  applyTiming();
  /* Cues and verdict art into memory now, so a roll never waits on a fetch. */
  cues.preloadAll();
  vitals.refreshVitals(null, true);
  renderScene();
  renderTurnEmptyState();
  paintReadyButton();
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();
  dom.nameInput.focus();
  setStatus("offline", "Offline");
})();
