import {
  ROOM_PREFIX,
  PLAYER_SLOTS,
  MAX_JOIN_ATTEMPTS,
  RETRY_DELAY_MS,
  TURN_MIN_LENGTH,
} from "./config.js";
import {
  uid,
  cleanName,
  cleanText,
  cleanImageUrl,
  isAdminName,
} from "./utils.js";
import { parseVideoId } from "./audio.js";

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

  sessionAlive(instance, generation) {
    return generation === this.sessionGeneration && instance === this.peer;
  }

  destroyPeer(instance) {
    if (!instance) return;
    try {
      instance.removeAllListeners();
      instance.destroy();
    } catch (e) {}
  }

  broadcast(payload, exceptPeerId) {
    this.downstream.forEach((conn, peerId) => {
      if (peerId === exceptPeerId || !conn.open) return;
      try {
        conn.send(payload);
      } catch (error) {}
    });
  }

  openRoom(roomId, profile, generation) {
    if (generation !== this.sessionGeneration) return;

    this.upstream = null;
    this.downstream.clear();
    this.isHost = false;

    const hostId = ROOM_PREFIX + roomId;
    const instance = new window.Peer(hostId, { debug: 1 });
    this.peer = instance;

    instance.on("open", () => {
      if (!this.sessionAlive(instance, generation)) return;
      this.startHost(generation, profile);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      if (error && error.type === "unavailable-id") {
        this.swapToGuest(hostId, generation, profile);
        return;
      }
      this.handlers.onStatus("error", "Network error");
      this.handlers.onSystemNote(
        `Signalling error: ${error?.type || "unknown"}`,
      );
    });

    this.bindReconnect(instance, generation);
  }

  startHost(generation, profile) {
    const instance = this.peer;
    this.isHost = true;
    this.joinAttempts = 0;
    this.selfId = instance.id;

    const admin = isAdminName(profile.name);
    this.handlers.onHostStarted(this.selfId, {
      id: this.selfId,
      name: profile.name,
      portrait: profile.portrait,
      admin: admin,
      slot: admin ? 0 : 1,
      ready: false,
    });

    this.handlers.onStatus("online", "Connected");

    instance.on("connection", (connection) => {
      if (!this.sessionAlive(instance, generation)) {
        try {
          connection.close();
        } catch (e) {}
        return;
      }

      connection.on("open", () => {
        if (!this.sessionAlive(instance, generation)) return;
        this.downstream.set(connection.peer, connection);
      });

      connection.on("data", (data) => {
        if (!this.sessionAlive(instance, generation) || !data?.type) return;
        this.handlers.onHostReceiveData(connection, data);
      });

      const drop = () => {
        if (!this.sessionAlive(instance, generation)) return;
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

    const instance = new window.Peer({ debug: 1 });
    this.peer = instance;

    instance.on("open", () => {
      if (!this.sessionAlive(instance, generation)) return;
      this.startGuest(hostId, generation, profile);
    });

    instance.on("error", (error) => {
      if (!this.sessionAlive(instance, generation)) return;
      if (error && error.type === "peer-unavailable") {
        this.retryJoin(generation, hostId, profile);
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
    this.handlers.onStatus("connecting", "Knocking…");

    const connection = instance.connect(hostId, { reliable: true });
    this.upstream = connection;

    const mine = () =>
      this.sessionAlive(instance, generation) && connection === this.upstream;

    connection.on("open", () => {
      if (!mine()) return;
      this.joinAttempts = 0;
      this.selfId = instance.id;
      this.handlers.onStatus("online", "Connected");
      connection.send({ type: "hello", profile });
    });

    connection.on("data", (data) => {
      if (!mine() || !data?.type) return;
      this.handlers.onGuestReceiveData(data);
    });

    connection.on("close", () => {
      if (!mine()) return;
      this.handlers.onStatus("error", "Disconnected");
      this.handlers.onUpstreamClose();
    });

    connection.on("error", () => {
      if (!mine()) return;
      this.handlers.onStatus("error", "Connection error");
    });
  }

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
    const stale = this.peer;
    this.peer = null;
    this.destroyPeer(stale);
    this.upstream = null;
    this.downstream.clear();
    this.isHost = false;
    this.selfId = null;
  }
}
