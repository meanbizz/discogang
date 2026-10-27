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
  CONNECT_TIMEOUT_MS,
  ICE_SERVERS,
} from "./config.js";

/* Ours, and never handed up to the app. */
const WIRE_ONLY = { ping: true, pong: true };

/* PeerJS caps JSON messages near 16 KB; 4000 chars stays under it even at 3 bytes a char. */
const CHUNK_CHARS = 4000;
const CHUNK_MAX_PARTS = 2500;
const CHUNK_TTL_MS = 60000;
let chunkSerial = 0;

export class NetworkManager {
  constructor(handlers) {
    this.debugLogs = [];
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
    this.forceRelay = false;
    /* Set once a relay-only attempt gathered nothing: TURN is unreachable. */
    this.turnDead = false;
    this.resumeTimer = null;
    this.connectTimer = null;
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

  logDebug(msg, detail) {
    const entry = `[${new Date().toISOString()}] ${msg}${detail !== undefined ? " " + (typeof detail === "object" ? JSON.stringify(detail) : detail) : ""}`;
    this.debugLogs.push(entry);
    if (this.debugLogs.length > 500) this.debugLogs.shift();
    console.debug("[Salon Net]", entry);
  }

  /* Replaces send on one connection so oversized payloads travel as numbered chunks. */
  wrapConnection(connection) {
    if (!connection || connection._salonChunked) return;
    connection._salonChunked = true;
    connection._salonInbox = new Map();
    const raw = connection.send.bind(connection);
    connection.send = (data, ...rest) => {
      let text;
      try {
        text = JSON.stringify(data);
      } catch (error) {
        return raw(data, ...rest);
      }
      if (typeof text !== "string" || text.length <= CHUNK_CHARS) {
        return raw(data, ...rest);
      }
      const total = Math.ceil(text.length / CHUNK_CHARS);
      if (total > CHUNK_MAX_PARTS) {
        this.logDebug(`Dropped outgoing "${data?.type}" — too large (${text.length} chars)`);
        return;
      }
      chunkSerial += 1;
      const id = chunkSerial.toString(36) + "-" + Date.now().toString(36);
      for (let i = 0; i < total; i += 1) {
        raw({
          type: "chunk",
          id,
          i,
          n: total,
          d: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
        });
      }
    };
  }

  /* Returns the whole message, or null while its chunks are still arriving. */
  unchunk(connection, data) {
    if (!data || data.type !== "chunk") return data;
    if (!connection._salonInbox) connection._salonInbox = new Map();
    const inbox = connection._salonInbox;
    const now = Date.now();
    inbox.forEach((held, key) => {
      if (now - held.at > CHUNK_TTL_MS) inbox.delete(key);
    });

    const id = String(data.id || "");
    const n = Number(data.n);
    const i = Number(data.i);
    if (
      !id ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > CHUNK_MAX_PARTS ||
      !Number.isInteger(i) ||
      i < 0 ||
      i >= n ||
      typeof data.d !== "string"
    ) {
      return null;
    }

    let held = inbox.get(id);
    if (!held || held.parts.length !== n) {
      held = { parts: new Array(n), got: 0, at: now };
      inbox.set(id, held);
    }
    if (held.parts[i] === undefined) {
      held.parts[i] = data.d;
      held.got += 1;
    }
    held.at = now;
    if (held.got < n) return null;

    inbox.delete(id);
    try {
      return JSON.parse(held.parts.join(""));
    } catch (error) {
      this.logDebug("A chunked message failed to reassemble");
      return null;
    }
  }

  getDebugText() {
    return this.debugLogs.length
      ? this.debugLogs.join("\n")
      : "No connectivity logs recorded.";
  }

  attachIceDebug(connection, label) {
    const attach = (pc) => {
      if (!pc || pc._debugAttached) return;
      pc._debugAttached = true;
      this.logDebug(`${label} RTCPeerConnection created`);
      pc.addEventListener("icegatheringstatechange", () => {
        this.logDebug(`${label} ICE gathering: ${pc.iceGatheringState}`);
      });
      pc.addEventListener("iceconnectionstatechange", () => {
        this.logDebug(`${label} ICE state: ${pc.iceConnectionState}`);
        if (
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "disconnected"
        ) {
          this.logPairStats(pc, label);
        }
      });
      pc.addEventListener("connectionstatechange", () => {
        this.logDebug(`${label} connection state: ${pc.connectionState}`);
      });
      pc.addEventListener("signalingstatechange", () => {
        this.logDebug(`${label} signaling state: ${pc.signalingState}`);
      });
      pc.addEventListener("icecandidate", (e) => {
        if (e.candidate) {
          this.logDebug(
            `${label} ICE candidate: ${e.candidate.type || "unknown"} ${e.candidate.protocol || ""} ${e.candidate.address || ""}`,
          );
        } else {
          this.logDebug(`${label} ICE candidate gathering complete`);
        }
      });
    };
    if (connection.peerConnection) attach(connection.peerConnection);
    else setTimeout(() => attach(connection.peerConnection), 50);
  }

  // Dumps remote candidates and pair states so a failed route can be diagnosed.
  logPairStats(pc, label) {
    if (!pc || typeof pc.getStats !== "function") return;
    pc.getStats()
      .then((report) => {
        let remotes = 0;
        report.forEach((s) => {
          if (s.type === "remote-candidate") {
            remotes += 1;
            const addr = s.address || s.ip || "";
            const mdns = /\.local$/i.test(addr) ? " (mDNS-obfuscated)" : "";
            this.logDebug(
              `${label} remote candidate: ${s.candidateType} ${s.protocol || ""} ${addr}${mdns}`,
            );
          } else if (s.type === "candidate-pair") {
            this.logDebug(`${label} candidate pair: ${s.state}`, {
              nominated: Boolean(s.nominated),
              sent: s.requestsSent || 0,
              recv: s.responsesReceived || 0,
            });
          }
        });
        if (!remotes)
          this.logDebug(
            `${label} no remote candidates left in stats (none arrived, or every pair was pruned)`,
          );
      })
      .catch(() => {});
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
      typeof document !== "undefined" && document.visibilityState === "hidden"
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

    if (instance.disconnected && !this.reclaimTimer) {
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
    this.logDebug(
      `Opening room as "${profile?.name}" (target hostId: ${hostId})`,
    );
    const instance = new window.Peer(hostId, {
      debug: 2,
      pingInterval: PEER_PING_MS,
      config: { iceServers: ICE_SERVERS },
    });
    this.peer = instance;

    instance.on("open", (id) => {
      if (!this.sessionAlive(instance, generation)) return;
      this.logDebug(`Claimed host ID: ${id}`);
      this.heldId = true;
      this.reclaimAttempts = 0;
      this.startHost(generation, profile);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      this.logDebug(
        `Host peer error: ${error?.type || "unknown"}`,
        error?.message || "",
      );
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

    // The seats live on this peer's data channels, so it is kept and only its socket is retried.
    this.clearTimer("reclaimTimer");

    if (this.reclaimAttempts >= MAX_RECLAIM_ATTEMPTS) {
      this.handlers.onStatus("error", "Room unreachable");
      this.handlers.onSystemNote(
        "The signalling server will not hand this room back. Seated players stay connected; newcomers cannot join until you rejoin.",
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
      const instance = this.peer;
      if (instance && !instance.destroyed) {
        try {
          instance.reconnect();
        } catch (error) {}
        return;
      }
      this.reopenAsHost(this.roomId, this.profile, generation);
    }, RECLAIM_DELAY_MS);
  }

  /* Like openRoom, but it knows it is coming back rather than arriving. */
  reopenAsHost(roomId, profile, generation) {
    if (generation !== this.sessionGeneration) return;

    const hostId = ROOM_PREFIX + roomId;
    this.logDebug(
      `Reopening room as host (${hostId}), attempt ${this.reclaimAttempts}`,
    );
    const instance = new window.Peer(hostId, {
      debug: 2,
      pingInterval: PEER_PING_MS,
      config: { iceServers: ICE_SERVERS },
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

    // A signalling reconnect fires open again; the listener is bound once per peer.
    if (instance._salonHosting) return;
    instance._salonHosting = true;
    instance.on("connection", (connection) => {
      this.logDebug(`Incoming connection from peer: ${connection.peer}`);
      /* PeerJS builds the answer before this event is emitted, so closing a
         live connection here replies and then kills gathering — the guest
         reaches stable and never receives a candidate. Only a peer that is
         actually gone may refuse. */
      if (instance.destroyed || instance !== this.peer) {
        try {
          connection.close();
        } catch (error) {}
        return;
      }

      this.attachIceDebug(connection, `Host<-${connection.peer}`);
      this.wrapConnection(connection);

      if (connection.peerConnection) {
        connection.peerConnection.addEventListener(
          "iceconnectionstatechange",
          () => {
            const state = connection.peerConnection?.iceConnectionState;
            if (state === "failed" || state === "closed") drop();
          },
        );
      }

      connection.on("open", () => {
        if (!this.sessionAlive(instance, generation)) return;
        this.logDebug(`Downstream channel open with: ${connection.peer}`);
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
        data = this.unchunk(connection, data);
        if (!data?.type) return;
        if (WIRE_ONLY[data.type]) {
          if (data.type === "ping") {
            try {
              connection.send({ type: "pong", at: Date.now() });
            } catch (error) {}
          }
          return;
        }
        this.logDebug(`Host received "${data.type}" from ${connection.peer}`);
        this.handlers.onHostReceiveData(connection, data);
      });

      /* Only the connection still on file can drop the seat: a replaced
         association closing late must not carry off the wire that took its
         place. */
      const drop = (err) => {
        if (!this.sessionAlive(instance, generation)) return;
        if (this.downstream.get(connection.peer) !== connection) return;
        this.logDebug(
          `Downstream peer dropped: ${connection.peer}`,
          err?.message || "",
        );
        this.downstream.delete(connection.peer);
        this.handlers.onPeerDrop(connection.peer);
      };
      connection.on("close", () => drop());
      // A non-fatal error leaves the channel open; dropping it would orphan a live seat.
      connection.on("error", (err) => {
        if (connection.open) {
          this.logDebug(`Downstream error from ${connection.peer}`, err?.message || "");
          return;
        }
        drop(err);
      });
    });
  }

  swapToGuest(hostId, generation, profile) {
    const stale = this.peer;
    this.peer = null;
    this.destroyPeer(stale);
    if (generation !== this.sessionGeneration) return;

    const transportPolicy = this.forceRelay && !this.turnDead ? "relay" : "all";
    this.logDebug(
      `Swapping to guest mode to dial host: ${hostId} (policy: ${transportPolicy})`,
    );
    const instance = new window.Peer({
      debug: 2,
      pingInterval: PEER_PING_MS,
      config: { iceServers: ICE_SERVERS, iceTransportPolicy: transportPolicy },
    });
    this.peer = instance;

    instance.on("open", (id) => {
      if (!this.sessionAlive(instance, generation)) return;
      this.logDebug(`Guest signaling open with ID: ${id}`);
      setTimeout(() => {
        if (this.sessionAlive(instance, generation)) {
          this.startGuest(hostId, generation, profile);
        }
      }, 150);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      this.logDebug(
        `Guest peer error: ${error?.type || "unknown"}`,
        error?.message || "",
      );
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

    this.clearTimer("connectTimer");
    this.logDebug(`Dialling host ${hostId} from guest ${instance.id}`);
    const connection = instance.connect(hostId, {
      reliable: true,
      serialization: "json",
    });
    this.upstream = connection;
    this.attachIceDebug(connection, `Guest->${hostId}`);
    this.wrapConnection(connection);

    const mine = () =>
      this.sessionAlive(instance, generation) && connection === this.upstream;

    // Abort stalled local/LAN handshakes that never fire open or error.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!mine() || connection.open) return;
      const ice = connection.peerConnection?.iceConnectionState || "unknown";
      this.logDebug(`Handshake timed out (ICE state: ${ice})`);
      if (ice === "checking") {
        this.logDebug("ICE still checking; extending timeout by 8s");
        this.connectTimer = setTimeout(() => {
          this.connectTimer = null;
          if (!mine() || connection.open) return;
          this.logDebug("Extended handshake timed out — redialling");
          this.resumeUpstream("Handshake timed out — redialling…");
        }, 8000);
        return;
      }
      this.resumeUpstream("Handshake timed out — redialling…");
    }, CONNECT_TIMEOUT_MS);

    const bindPc = (pc) => {
      if (!pc) return;
      const onFail = (reason) => {
        if (!mine() || connection.open) return;
        this.clearTimer("connectTimer");
        this.logPairStats(pc, `Guest->${hostId}`);
        // One relay attempt is enough; a dead TURN never revives mid-session.
        this.forceRelay = !this.turnDead && !this.forceRelay;
        this.logDebug(`${reason} — relay ${this.forceRelay} and redialling`);
        this.resumeUpstream("Route failed — redialling…", true);
      };
      pc.addEventListener("iceconnectionstatechange", () => {
        const state = pc.iceConnectionState;
        if (state === "failed") {
          onFail("ICE state failed");
          return;
        }
        if (state === "disconnected" && !connection.open) {
          /* Checks timed out. The handshake timer redials on this same peer,
             which is cheaper than rebuilding the signalling socket. */
          this.logDebug(
            "ICE went quiet while handshaking — leaving it to the handshake timer",
          );
          this.logPairStats(pc, `Guest->${hostId}`);
        }
      });
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") {
          onFail("PeerConnection failed");
        }
      });
      let gathered = 0;
      pc.addEventListener("icecandidate", (e) => {
        if (e.candidate) gathered += 1;
      });
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState !== "complete" || !this.forceRelay) return;
        if (gathered || / typ /.test(pc.localDescription?.sdp || "")) return;
        this.turnDead = true;
        onFail("No relay candidates gathered (TURN unreachable)");
      });
    };
    if (connection.peerConnection) bindPc(connection.peerConnection);
    else setTimeout(() => bindPc(connection.peerConnection), 50);

    connection.on("open", () => {
      if (!mine()) return;
      this.clearTimer("connectTimer");
      this.logDebug(`Upstream connection open with host ${hostId}`);
      this.joinAttempts = 0;
      this.forceRelay = false;
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
      data = this.unchunk(connection, data);
      if (!data?.type) return;
      if (WIRE_ONLY[data.type]) {
        if (data.type === "ping") {
          try {
            connection.send({ type: "pong", at: Date.now() });
          } catch (error) {}
        }
        return;
      }
      this.logDebug(`Guest received "${data.type}" from host`);
      this.handlers.onGuestReceiveData(data);
    });

    connection.on("close", () => {
      if (!mine()) return;
      this.clearTimer("connectTimer");
      this.logDebug("Upstream connection closed");
      this.upstream = null;
      this.resumeUpstream("The room went quiet — redialling…");
    });

    connection.on("error", (err) => {
      if (!mine()) return;
      this.logDebug("Upstream connection error", err?.message || "");
      // A non-fatal error leaves the channel open, so the wire is kept.
      if (connection.open) return;
      this.clearTimer("connectTimer");
      this.resumeUpstream("Connection error — redialling…");
    });
  }

  /* A guest that has lost its host dials again, waiting a little longer each
     time. The app is only told the room is closed once the attempts run out —
     a single dropped association is not the end of a session. */
  resumeUpstream(note, rebuildPeer = false) {
    if (this.isHost || !this.hostId) return;
    if (this.resumeTimer) return;
    this.clearTimer("connectTimer");

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
      if (rebuildPeer || !instance || instance.destroyed) {
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
      // A reclaim in progress owns the retry timing.
      if (this.reclaimTimer) return;
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
    this.forceRelay = false;
    this.reclaimAttempts = 0;
    this.heldId = false;
    this.probeAt = 0;
    this.clearTimer("connectTimer");
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
