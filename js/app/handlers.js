/* js/app/handlers.js */

/* The two sides of the wire. Every message a peer sends lands in one of these
   handlers, which is also the only place a peer's claim is weighed against
   who they are.

   A seat that comes back after a dropped wire says so, and the host hands it
   the slot, the flags and the progress it had rather than seating a stranger
   in the middle of a round. */

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
import { cleanOps } from "../inventory/items.js";
import {
  state,
  normalizeEntry,
  rosterPayload,
  cleanProgress,
  rememberSeat,
  recallSeat,
  recallProgress,
} from "./state.js";
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
import { commitOps, inventoryPayload, setInventory } from "./inventory.js";
import { adoptProgress, publishProgress } from "./progress.js";
import {
  acceptChoice,
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
    /* What this name had when it last sat here, and what a loaded save
       remembers of it. The seat wins: it is the more recent of the two. */
    const seat = joiningAdmin ? null : recallSeat(name);
    const saved = joiningAdmin ? null : recallProgress(name);
    const held = seat || saved;
    /* Only a peer that says it is resuming inherits the flags. A fresh join
       under a familiar name is still a fresh join. */
    const resuming = Boolean(seat && data.resuming);

    state.roster.set(connection.peer, {
      id: connection.peer,
      name,
      portrait: cleanImageUrl(data.profile?.portrait),
      admin: joiningAdmin,
      slot: joiningAdmin
        ? 0
        : previous?.slot || (held && held.slot) || network.nextSlot(state.roster),
      /* Readying up again, or re-reading a scene already finished, is not
         something a dropped wire should cost anybody. */
      ready: resuming && Boolean(seat.ready),
      done: resuming && Boolean(seat.done),
      skills: held ? held.skills || {} : {},
      allocated: held ? held.allocated || {} : {},
      xp: held ? held.xp || null : null,
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
      /* The catalogue and every bag, so a joiner can read their pockets. */
      items: state.items,
      inventories: state.inventories,
      dialogue: state.dialoguePayload,
      /* Each round carries what was chosen in it, so a joiner inherits the
         whole record and not just the trees. */
      rounds: state.dialogueRounds,
      /* A round on record is not a scene in progress: after a restore this is
         false, and a joining player reads the history instead. */
      live: state.dialogueLive,
      /* Only what a save recorded is worth handing back. A seat that merely
         lost its wire still has its own ledger in memory, and its own copy is
         the better one. */
      progress: resuming ? null : saved || null,
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

  /* A seat's own experience and skills. Nobody else's to claim, and nothing
     the host does anything with beyond keeping and passing it on: the
     administrateur reads it at import, and a save writes it down. */
  if (data.type === "progress") {
    if (!person || person.admin) return;
    const reading = cleanProgress(data);
    person.skills = reading.skills;
    person.allocated = reading.allocated;
    person.xp = reading.xp;
    /* Remembered now rather than at the drop, so a wire that dies without
       warning still leaves the ledger behind. */
    rememberSeat(person);
    broadcast(rosterPayload());
    return;
  }

  /* A choice is only ever a player's own, so the author is the connection's
     and never the peer's to claim. Relayed on so the administrateur's copy of
     the round agrees with the host's. */
  if (data.type === "choice") {
    if (!person || person.admin) return;
    const kept = acceptChoice(person.name, data.roundId, data.choice);
    if (!kept) return;
    broadcast(
      {
        type: "choice",
        roundId: kept.round.id,
        author: kept.author,
        choice: kept.choice,
      },
      connection.peer,
    );
    return;
  }

  if (data.type === "dialogue") {
    if (!person?.admin) return;
    const payload = dialogue.cleanPayload(data.payload);
    if (!payload) return;
    openDialogueRound(payload, data.roundId, data.at);
    return;
  }

  /* Items move here and nowhere else, so every bag agrees with this one. */
  if (data.type === "inventory-ops") {
    if (!person?.admin) return;
    const ops = cleanOps(data.ops);
    if (!ops) return;
    commitOps(ops);
    return;
  }

  /* The administrateur edited the catalogue, which can rename what people
     already carry, so the whole thing is adopted and passed on. */
  if (data.type === "inventory-state") {
    if (!person?.admin) return;
    setInventory(data.items, data.inventories);
    broadcast(inventoryPayload(), connection.peer);
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
    music.applyTrack(track);
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
  setInventory(data.items, data.inventories);

  /* A save the room already read may hold this seat's ledger. Adopting it
     publishes; otherwise the table is simply told what this seat brought. */
  if (data.progress) adoptProgress(data.progress);
  else publishProgress();

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
      const reading = cleanProgress(raw);
      state.roster.set(raw.id, {
        id: raw.id,
        name,
        portrait: cleanImageUrl(raw.portrait),
        admin: isAdminName(name),
        slot,
        ready: Boolean(raw.ready),
        done: Boolean(raw.done),
        skills: reading.skills,
        allocated: reading.allocated,
        xp: reading.xp,
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

  /* The host names the author; nothing is relayed on from here. */
  if (data.type === "choice") {
    acceptChoice(data.author, data.roundId, data.choice);
    return;
  }

  /* A save landed on the table while this seat was already in it, and it had
     something to say about this seat in particular. */
  if (data.type === "progress-restore") {
    adoptProgress(data.progress);
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

  if (data.type === "inventory") {
    setInventory(data.items, data.inventories);
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
    );
  }
}

setHandlers({
  onStatus: setStatus,
  onSystemNote: systemNote,
  onHostStarted: (selfId, hostProfile) => {
    state.selfId = selfId;
    state.roster.set(
      selfId,
      Object.assign(
        { done: false, skills: {}, allocated: {}, xp: null },
        hostProfile,
      ),
    );
    renderRoster();
    /* The host may be a player too, in which case the table should know what
       they are carrying in their head. */
    publishProgress();
  },
  onPeerDrop: (peerId) => {
    const person = state.roster.get(peerId);
    /* Kept before it is dropped: this is the whole of what lets a player who
       lost their wire sit back down where they were. */
    if (person) rememberSeat(person);
    state.roster.delete(peerId);
    renderRoster();
    broadcast(rosterPayload());
  },
  onHostReceiveData,
  onGuestReceiveData,
  onUpstreamClose: () => {
    state.roster.clear();
    renderRoster();
    systemNote(
      "The room stopped answering, after several tries. Rejoin to reopen it.",
    );
  },
});
