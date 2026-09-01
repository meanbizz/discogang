/* The two sides of the wire. Every message a peer sends lands in one of these
   handlers, which is also the only place a peer's claim is weighed against
   who they are. */

import { TURN_MIN_LENGTH, PLAYER_SLOTS } from "../config.js";
import {
  uid,
  cleanName,
  cleanImageUrl,
  cleanText,
  isAdminName,
} from "../utils.js";
import * as dialogue from "../dialogue/dialogue.js";
import * as music from "../audio/music.js";
import * as session from "../export/session.js";
import { latestPayload } from "../export/rounds.js";
import { state, normalizeEntry, rosterPayload } from "./state.js";
import { network, setHandlers, broadcast } from "./net.js";
import {
  commit,
  commitTurn,
  paintReadyButton,
  renderRoster,
  replaceLog,
  replaceTurnLog,
  setStatus,
  systemNote,
} from "./views.js";
import { refreshPlanningLock } from "./locks.js";
import { applyScene, setNpcs } from "./scene.js";
import { applySession } from "./save.js";
import {
  applyDialogue,
  openDialogueRound,
  rememberRound,
  replaceRounds,
  showDialogueHistory,
} from "./rounds.js";

function onHostReceiveData(connection, data) {
  const person = state.roster.get(connection.peer);

  if (data.type === "hello") {
    const name = cleanName(data.profile?.name) || "Unnamed";
    const joiningAdmin = isAdminName(name);
    const previous = state.roster.get(connection.peer);

    state.roster.set(connection.peer, {
      id: connection.peer,
      name,
      portrait: cleanImageUrl(data.profile?.portrait),
      admin: joiningAdmin,
      slot: joiningAdmin ? 0 : previous?.slot || network.nextSlot(state.roster),
      ready: false,
      done: false,
    });

    renderRoster();

    connection.send({
      type: "welcome",
      id: connection.peer,
      entries: state.logEntries,
      turns: state.turnEntries,
      track: music.getCurrentTrack(),
      scene: state.scene,
      npcs: state.npcs,
      dialogue: state.dialoguePayload,
      rounds: state.dialogueRounds,
      /* A round on record is not a scene in progress: after a restore this is
         false, and a joining player reads the history instead. */
      live: state.dialogueLive,
    });

    connection.send(rosterPayload());
    broadcast(rosterPayload(), connection.peer);
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
    broadcast({ type: "entry", entry });
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
    broadcast({ type: "turn", turn: planned });
    return;
  }

  if (data.type === "ready") {
    if (!person || person.admin) return;
    person.ready = Boolean(data.ready);
    renderRoster();
    broadcast(rosterPayload());
    return;
  }

  if (data.type === "dialogue-done") {
    if (!person || person.admin) return;
    person.done = true;
    renderRoster();
    broadcast(rosterPayload());
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
    broadcast({ type: "session", session: loaded }, connection.peer);
    return;
  }

  if (data.type === "track-request") {
    if (!person?.admin) return;
    const videoId = data.track ? music.parseVideoId(data.track.videoId) : null;
    const track = videoId ? { videoId, startedAt: Date.now() } : null;
    music.applyTrack(track, state.isAdmin);
    broadcast({ type: "track", track });
    return;
  }

  if (data.type === "npc-sync") {
    if (!person?.admin) return;
    setNpcs(data.npcs);
    broadcast({ type: "npcs", npcs: state.npcs }, connection.peer);
  }
}

function onWelcome(data) {
  if (typeof data.id === "string") {
    network.selfId = data.id;
    state.selfId = data.id;
  }

  /* The history comes first: the log is about to be rebuilt from entries that
     may name these rounds. */
  replaceRounds(data.rounds, data.dialogue);

  /* The room says which kind of payload this is. A live one is the scene
     being played now; one merely on record is read back as transcript. */
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

  if (state.dialogueRounds.length) {
    showDialogueHistory(
      live ? state.dialogueRounds.slice(0, -1) : state.dialogueRounds,
    );
  }

  if (live) {
    applyDialogue(current);
  } else {
    state.dialoguePayload = current || latestPayload(state.dialogueRounds);
    state.dialogueLive = false;
    dialogue.reset();
    refreshPlanningLock();
  }

  const videoId = data.track ? music.parseVideoId(data.track.videoId) : null;
  music.applyTrack(
    videoId
      ? { videoId, startedAt: Number(data.track.startedAt) || Date.now() }
      : null,
    state.isAdmin,
  );
}

function onGuestReceiveData(data) {
  if (data.type === "welcome") {
    onWelcome(data);
    return;
  }

  if (data.type === "roster" && Array.isArray(data.people)) {
    state.roster.clear();
    data.people.forEach((raw) => {
      if (!raw || typeof raw.id !== "string") return;
      const name = cleanName(raw.name) || "Unnamed";
      let slot = Number(raw.slot) || 0;
      if (slot < 0 || slot > PLAYER_SLOTS) slot = 0;
      state.roster.set(raw.id, {
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
    const me = state.roster.get(network.selfId);
    if (me && !state.isAdmin && Boolean(me.ready) !== state.selfReady) {
      state.selfReady = Boolean(me.ready);
      paintReadyButton();
    }
    replaceTurnLog(state.turnEntries);
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

  if (data.type === "turns") {
    replaceTurnLog(
      (Array.isArray(data.turns) ? data.turns : [])
        .map(normalizeEntry)
        .filter(Boolean),
    );
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

  if (data.type === "session") {
    const loaded = session.clean(data.session);
    if (loaded) applySession(loaded);
    return;
  }

  if (data.type === "track") {
    const videoId = data.track ? music.parseVideoId(data.track.videoId) : null;
    music.applyTrack(
      videoId
        ? { videoId, startedAt: Number(data.track.startedAt) || Date.now() }
        : null,
      state.isAdmin,
    );
  }
}

setHandlers({
  onStatus: setStatus,
  onSystemNote: systemNote,
  onHostStarted: (selfId, hostProfile) => {
    state.selfId = selfId;
    state.roster.set(selfId, Object.assign({ done: false }, hostProfile));
    renderRoster();
  },
  onPeerDrop: (peerId) => {
    state.roster.delete(peerId);
    renderRoster();
    broadcast(rosterPayload());
  },
  onHostReceiveData,
  onGuestReceiveData,
  onUpstreamClose: () => {
    state.roster.clear();
    renderRoster();
    systemNote("The room closed. Rejoin to reopen it.");
  },
});
