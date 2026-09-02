/* PeerJS plumbing. The first peer to claim the room id is the host; anybody
   who finds it taken becomes a guest and connects to it. Every callback the
   app registers arrives through the handlers object.

   Staying up is most of this file. Five things used to end a session at around
   the quarter-hour mark, and each has its answer here:

     1. A reconnect that raced the signalling server's own bookkeeping came
        back as unavailable-id, and the host read that as somebody else owning
        the room — so it demoted itself to a guest and dialled a host that no
        longer existed. heldId records that this peer has actually held the id,
        which is what tells the two cases apart: before, the room is somebody
        else's; after, it is our own stale registration, and it is reclaimed.

     2. PeerJS pings the signalling socket on a JS timer, and a backgrounded
        tab's timers are throttled to roughly one a minute — slack enough to
        miss the server's idle window and have the socket reaped. pingInterval
        is set explicitly, and the watchdog below re-checks the link the moment
        the tab is looked at again rather than trusting any timer.

     3. A dropped data connection was terminal: a guest printed "the room
        closed" and stopped. Guests now re-dial with a growing delay, and the
        host hands a returning seat its slot and flags back.

     4. Nothing crossed an idle wire, so NAT mappings were collected out from
        under a quiet table. A ping/pong now crosses every open connection, and
        doubles as the liveness signal for links that die without ever firing
        close.

     5. That same liveness signal then became the problem: silence measured
        across a throttled tab was read as a death, and a healthy wire was torn
        down and re-dialled — which had the host re-welcome the seat and the
        player replay the scene they were reading. Silence is now only ever
        judged while the tab is visible, the line is asked once before it is
        condemned, and the clock starts again the moment the tab wakes. A stale
        association closing can no longer drop the wire that replaced it,
        either: the drop is only honoured for the connection still on file. */

import {
  ROOM_PREFIX,
  PLAYER_SLOTS,
  MAX_JOIN_ATTEMPTS,
  RETRY_DELAY_MS,
  PEER_PING_MS,
  KEEPALIVE_MS,
  LINK_WATCH_MS,
  LINK_STALE_MS,
  LINK_PROBE_MS,
  MAX_RESUME_ATTEMPTS,
  RESUME_DELAY_MS,
  RESUME_MAX_DELAY_MS,
  MAX_RECLAIM_ATTEMPTS,
  RECLAIM_DELAY_MS,
} from "./config.js";

/* Ours, and never handed up to the app. */
const WIRE_ONLY = { ping: true, pong: true };

export class NetworkManager {
  constructor(handlers) {
    this.handlers = handlers;
    this.peer = null;
    this.isHost = false;
    this.upstream = null;
    this.downstream = new Map();
    this.sessionGeneration = 0;
    this.joinAttempts = 0;
    this.selfId = null;

    /* What the room is, kept so a lost link can be dialled again without the
       app being asked to remember it. */
    this.roomId = "";
    this.profile = null;
    /* Set once the signalling server has actually granted the room id. From
       then on, unavailable-id is our own ghost rather than a rival. */
    this.heldId = false;

    this.resumeAttempts = 0;
    this.resumeTimer = null;
    this.reclaimAttempts = 0;
    this.reclaimTimer = null;
    this.keepaliveTimer = null;
    this.watchTimer = null;
    this.lastHeard = 0;
    /* When the line was last asked whether it is still there. Zero means the
       question has not been put. */
    this.probeAt = 0;
    this.bound = false;
  }

  nextSlot(roster) {
    const taken = {};
    roster.forEach((person) => {
      if (person.slot) taken[person.slot] = true;
    });
    for (let i = 1; i <= PLAYER_SLOTS; i += 1) {
      if (!taken[i]) return i;
    }
    return 0;
  }

  /* A callback from a torn-down session must not touch the current one. */
  sessionAlive(instance, generation) {
    return generation === this.sessionGeneration && instance === this.peer;
  }

  destroyPeer(instance) {
    if (!instance) return;
    try {
      instance.removeAllListeners();
      instance.destroy();
    } catch (error) {}
  }

  broadcast(payload, exceptPeerId) {
    this.downstream.forEach((conn, peerId) => {
      if (peerId === exceptPeerId || !conn.open) return;
      try {
        conn.send(payload);
      } catch (error) {}
    });
  }

  /* ---------------- Liveness ---------------- */

  /* Anything at all arriving is proof the wire is still there, so every data
     handler reports through here — and any question in the air is answered. */
  heard() {
    this.lastHeard = Date.now();
    this.probeAt = 0;
  }

  hidden() {
    return (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    );
  }

  clearTimer(name) {
    if (this[name]) {
      clearTimeout(this[name]);
      this[name] = null;
    }
  }

  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  /* One beat across everything open. Cheap, and it is what keeps a NAT
     mapping from being collected while the table reads. */
  pingLinks() {
    const beat = { type: "ping", at: Date.now() };
    if (this.isHost) {
      this.broadcast(beat);
      return;
    }
    if (this.upstream && this.upstream.open) {
      try {
        this.upstream.send(beat);
      } catch (error) {}
    }
  }

  startKeepalive() {
    this.stopKeepalive();
    this.lastHeard = Date.now();
    this.probeAt = 0;

    this.keepaliveTimer = setInterval(() => this.pingLinks(), KEEPALIVE_MS);
    this.watchTimer = setInterval(() => this.checkLink(), LINK_WATCH_MS);
  }

  /* A link can die without ever firing close — the socket simply stops
     answering. Silence on its own is not proof of that: a backgrounded tab's
     timers are throttled, so our own beats stop going out long before
     anything is actually wrong. Two things follow. Silence is only judged
     while the tab is being looked at, and the verdict is never immediate: the
     line is asked once, and only silence that outlives the answer condemns
     it. Tearing down a healthy wire is the more expensive mistake — it costs
     the player the scene they are reading. */
  checkLink() {
    const instance = this.peer;
    if (!instance || instance.destroyed) return;

    if (instance.disconnected) {
      try {
        instance.reconnect();
      } catch (error) {}
    }

    if (this.isHost) return;
    if (this.hidden()) return;

    if (!this.upstream) {
      this.resumeUpstream("Reconnecting to the room…");
      return;
    }

    const silent = Date.now() - this.lastHeard;
    if (silent < LINK_STALE_MS) {
      this.probeAt = 0;
      return;
    }

    if (!this.upstream.open) {
      /* It never answered at all, so there is nothing to ask. */
      this.probeAt = 0;
      this.resumeUpstream("Reconnecting to the room…");
      return;
    }

    if (!this.probeAt) {
      this.probeAt = Date.now();
      this.pingLinks();
      return;
    }
    if (Date.now() - this.probeAt < LINK_PROBE_MS) return;
    this.probeAt = 0;
    this.resumeUpstream("The line went quiet — redialling…");
  }

  /* A hidden tab's timers cannot be trusted, so the two moments a browser
     hands back control are used directly. Bound once per manager. */
  bindWake() {
    if (this.bound) return;
    this.bound = true;

    /* The clock starts again here: whatever silence a throttled tab measured
       while it was away says nothing about the wire. The line is pinged and
       given the usual grace before anything is decided about it. */
    const wake = () => {
      if (!this.peer || this.hidden()) return;
      this.lastHeard = Date.now();
      this.probeAt = 0;
      this.pingLinks();
      this.checkLink();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
  }

  /* ---------------- Opening the room ---------------- */

  openRoom(roomId, profile, generation) {
    if (generation !== this.sessionGeneration) return;

    this.upstream = null;
    this.downstream.clear();
    this.isHost = false;
    this.roomId = roomId;
    this.profile = profile;
    this.bindWake();

    const hostId = ROOM_PREFIX + roomId;
    const instance = new window.Peer(hostId, {
      debug: 1,
      /* Explicit, because the default outlives a throttled tab's timers. */
      pingInterval: PEER_PING_MS,
    });
    this.peer = instance;

    instance.on("open", () => {
      if (!this.sessionAlive(instance, generation)) return;
      this.heldId = true;
      this.reclaimAttempts = 0;
      this.startHost(generation, profile);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      if (error && error.type === "unavailable-id") {
        /* Never held it: the room is somebody else's, so knock on it. Held it
           once: this is our own registration still being let go of, and the
           room is ours to take back. */
        if (this.heldId) this.reclaimRoom(generation);
        else this.swapToGuest(hostId, generation, profile);
        return;
      }
      if (error && error.type === "network") {
        /* Signalling only — the data connections are untouched. */
        this.handlers.onStatus("connecting", "Reaching the signalling server…");
        return;
      }
      this.handlers.onStatus("error", "Network error");
      this.handlers.onSystemNote(
        `Signalling error: ${error?.type || "unknown"}`,
      );
    });

    this.bindReconnect(instance, generation);
  }

  /* The host's own room id, refused because the server has not finished
     forgetting the socket we just lost. Waiting and asking again is the whole
     of the fix; demoting ourselves would take the room down with us. */
  reclaimRoom(generation) {
    if (generation !== this.sessionGeneration) return;

    const stale = this.peer;
    this.peer = null;
    this.destroyPeer(stale);
    this.clearTimer("reclaimTimer");

    if (this.reclaimAttempts >= MAX_RECLAIM_ATTEMPTS) {
      this.handlers.onStatus("error", "Room unreachable");
      this.handlers.onSystemNote(
        "The signalling server will not hand this room back. Leave and rejoin to reopen it.",
      );
      return;
    }

    this.reclaimAttempts += 1;
    this.handlers.onStatus("connecting", "Taking the room back…");
    this.reclaimTimer = setTimeout(() => {
      this.reclaimTimer = null;
      if (generation !== this.sessionGeneration) return;
      /* The seats we already hold are kept: this replaces the signalling
         socket, not the table. */
      this.reopenAsHost(this.roomId, this.profile, generation);
    }, RECLAIM_DELAY_MS);
  }

  /* Like openRoom, but it knows it is coming back rather than arriving. */
  reopenAsHost(roomId, profile, generation) {
    if (generation !== this.sessionGeneration) return;

    const hostId = ROOM_PREFIX + roomId;
    const instance = new window.Peer(hostId, {
      debug: 1,
      pingInterval: PEER_PING_MS,
    });
    this.peer = instance;

    instance.on("open", () => {
      if (!this.sessionAlive(instance, generation)) return;
      this.heldId = true;
      this.reclaimAttempts = 0;
      this.startHost(generation, profile);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      if (error && error.type === "unavailable-id") {
        this.reclaimRoom(generation);
        return;
      }
      if (error && error.type === "network") {
        this.handlers.onStatus("connecting", "Reaching the signalling server…");
        return;
      }
      this.handlers.onStatus("error", "Network error");
    });

    this.bindReconnect(instance, generation);
  }

  startHost(generation, profile) {
    const instance = this.peer;
    const returning = this.isHost;
    this.isHost = true;
    this.joinAttempts = 0;
    this.selfId = instance.id;
    this.startKeepalive();

    /* Coming back to a room we never left: the roster stands, so it is not
       announced again. */
    if (!returning) {
      const admin = this.handlers.isAdminName(profile.name);
      this.handlers.onHostStarted(this.selfId, {
        id: this.selfId,
        name: profile.name,
        portrait: profile.portrait,
        admin,
        slot: admin ? 0 : 1,
        ready: false,
      });
    }

    this.handlers.onStatus("online", "Connected");

    instance.on("connection", (connection) => {
      if (!this.sessionAlive(instance, generation)) {
        try {
          connection.close();
        } catch (error) {}
        return;
      }

      connection.on("open", () => {
        if (!this.sessionAlive(instance, generation)) return;
        /* A seat that re-dialled before its old association ever closed. The
           new wire is the live one; the old is let go of without being
           mourned as a drop. */
        const stale = this.downstream.get(connection.peer);
        this.downstream.set(connection.peer, connection);
        if (stale && stale !== connection) {
          try {
            stale.close();
          } catch (error) {}
        }
        this.heard();
      });

      connection.on("data", (data) => {
        if (!this.sessionAlive(instance, generation) || !data?.type) return;
        this.heard();
        if (WIRE_ONLY[data.type]) {
          if (data.type === "ping") {
            try {
              connection.send({ type: "pong", at: Date.now() });
            } catch (error) {}
          }
          return;
        }
        this.handlers.onHostReceiveData(connection, data);
      });

      /* Only the connection still on file can drop the seat: a replaced
         association closing late must not carry off the wire that took its
         place. */
      const drop = () => {
        if (!this.sessionAlive(instance, generation)) return;
        if (this.downstream.get(connection.peer) !== connection) return;
        this.downstream.delete(connection.peer);
        this.handlers.onPeerDrop(connection.peer);
      };
      connection.on("close", drop);
      connection.on("error", drop);
    });
  }

  swapToGuest(hostId, generation, profile) {
    const stale = this.peer;
    this.peer = null;
    this.destroyPeer(stale);
    if (generation !== this.sessionGeneration) return;

    const instance = new window.Peer({
      debug: 1,
      pingInterval: PEER_PING_MS,
    });
    this.peer = instance;

    instance.on("open", () => {
      if (!this.sessionAlive(instance, generation)) return;
      this.startGuest(hostId, generation, profile);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      if (error && error.type === "peer-unavailable") {
        /* Lost a host we had: re-dial it rather than starting over. */
        if (this.resumeAttempts > 0) this.resumeUpstream("");
        else this.retryJoin(generation, hostId, profile);
        return;
      }
      if (error && error.type === "network") {
        this.handlers.onStatus("connecting", "Reaching the signalling server…");
        return;
      }
      this.handlers.onStatus("error", "Network error");
      this.handlers.onSystemNote(
        `Signalling error: ${error?.type || "unknown"}`,
      );
    });

    this.bindReconnect(instance, generation);
  }

  startGuest(hostId, generation, profile) {
    const instance = this.peer;
    this.isHost = false;
    this.hostId = hostId;
    this.handlers.onStatus("connecting", "Knocking…");

    const connection = instance.connect(hostId, { reliable: true });
    this.upstream = connection;

    const mine = () =>
      this.sessionAlive(instance, generation) && connection === this.upstream;

    connection.on("open", () => {
      if (!mine()) return;
      this.joinAttempts = 0;
      const returning = this.resumeAttempts > 0;
      this.resumeAttempts = 0;
      this.selfId = instance.id;
      this.startKeepalive();
      this.handlers.onStatus("online", "Connected");
      /* A resumed seat says so, so the host can hand back its slot and its
         ready and finished flags instead of seating a stranger. */
      connection.send({ type: "hello", profile, resuming: returning });
    });

    connection.on("data", (data) => {
      if (!mine() || !data?.type) return;
      this.heard();
      if (WIRE_ONLY[data.type]) {
        if (data.type === "ping") {
          try {
            connection.send({ type: "pong", at: Date.now() });
          } catch (error) {}
        }
        return;
      }
      this.handlers.onGuestReceiveData(data);
    });

    connection.on("close", () => {
      if (!mine()) return;
      this.upstream = null;
      this.resumeUpstream("The room went quiet — redialling…");
    });

    connection.on("error", () => {
      if (!mine()) return;
      this.handlers.onStatus("error", "Connection error");
    });
  }

  /* A guest that has lost its host dials again, waiting a little longer each
     time. The app is only told the room is closed once the attempts run out —
     a single dropped association is not the end of a session. */
  resumeUpstream(note) {
    if (this.isHost || !this.hostId) return;
    if (this.resumeTimer) return;

    const generation = this.sessionGeneration;
    const stale = this.upstream;
    this.upstream = null;
    this.probeAt = 0;
    if (stale) {
      try {
        stale.close();
      } catch (error) {}
    }

    if (this.resumeAttempts >= MAX_RESUME_ATTEMPTS) {
      this.stopKeepalive();
      this.handlers.onStatus("error", "Disconnected");
      this.handlers.onUpstreamClose();
      return;
    }

    this.resumeAttempts += 1;
    const wait = Math.min(
      RESUME_MAX_DELAY_MS,
      RESUME_DELAY_MS * this.resumeAttempts,
    );
    this.handlers.onStatus(
      "connecting",
      note || `Reconnecting — attempt ${this.resumeAttempts}…`,
    );

    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (generation !== this.sessionGeneration) return;

      const instance = this.peer;
      if (!instance || instance.destroyed) {
        /* The whole peer is gone, so it is rebuilt around the same host id. */
        this.swapToGuest(this.hostId, generation, this.profile);
        return;
      }
      if (instance.disconnected) {
        try {
          instance.reconnect();
        } catch (error) {}
      }
      this.startGuest(this.hostId, generation, this.profile);
    }, wait);
  }

  /* The room may still be settling after the host claimed the id. */
  retryJoin(generation, hostId, profile) {
    if (generation !== this.sessionGeneration) return;

    const stale = this.peer;
    this.peer = null;
    this.destroyPeer(stale);

    if (this.joinAttempts >= MAX_JOIN_ATTEMPTS) {
      this.handlers.onStatus("error", "Unreachable");
      this.handlers.onSystemNote(
        "Nobody answered here. Leave and rejoin to try again.",
      );
      return;
    }

    this.joinAttempts += 1;
    this.handlers.onStatus("connecting", "The room is settling… retrying");
    setTimeout(() => {
      this.openRoom(hostId.replace(ROOM_PREFIX, ""), profile, generation);
    }, RETRY_DELAY_MS);
  }

  bindReconnect(instance, generation) {
    instance.on("disconnected", () => {
      if (!this.sessionAlive(instance, generation) || instance.destroyed)
        return;
      this.handlers.onStatus("connecting", "Reconnecting…");
      try {
        instance.reconnect();
      } catch (error) {}
    });
  }

  disconnect() {
    this.sessionGeneration += 1;
    this.joinAttempts = 0;
    this.resumeAttempts = 0;
    this.reclaimAttempts = 0;
    this.heldId = false;
    this.probeAt = 0;
    this.clearTimer("resumeTimer");
    this.clearTimer("reclaimTimer");
    this.stopKeepalive();
    const stale = this.peer;
    this.peer = null;
    this.destroyPeer(stale);
    this.upstream = null;
    this.hostId = "";
    this.roomId = "";
    this.profile = null;
    this.downstream.clear();
    this.isHost = false;
    this.selfId = null;
  }
}
