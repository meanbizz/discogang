// Fast delta and Yjs synchronization over PeerJS for the Konva background canvas.
import * as Y from "https://esm.sh/yjs@13.6.18";
import { network, broadcast, sendUpstream } from "../app/net.js";

const ORIGIN_REMOTE = "remote-yjs";

export class CanvasSync {
  constructor(stage) {
    this.stage = stage;
    this.doc = new Y.Doc();
    this.metaMap = this.doc.getMap("meta");
    this.spritesMap = this.doc.getMap("sprites");
    this.interestsMap = this.doc.getMap("canvas-interests");
    this.stage.interestMarkers = new Map();
    this.bindStage();
    this.bindDoc();
  }

  sendOp(op, exceptPeerId = null) {
    const msg = Object.assign({ type: "canvas-op" }, op);
    if (network.isHost) {
      broadcast(msg, exceptPeerId);
    } else {
      sendUpstream(msg);
    }
  }

  bindStage() {
    if (!this.stage) return;
    this.stage.callbacks = {
      onInterestChange: (marker) => {
        if (!marker || !marker.id) return;
        const key = String(marker.id);
        this.stage.interestMarkers.set(key, marker);
        this.doc.transact(() => {
          this.interestsMap.set(key, marker);
        }, ORIGIN_REMOTE);
        this.stage.notifyChange();
        this.sendOp({ op: "interest-upsert", marker });
      },
      onInterestRemove: (id) => {
        if (!id) return;
        const key = String(id);
        this.stage.interestMarkers.delete(key);
        this.doc.transact(() => {
          this.interestsMap.delete(key);
        }, ORIGIN_REMOTE);
        this.stage.notifyChange();
        this.sendOp({ op: "interest-remove", id: key });
      },
      onBackgroundChange: (url) => {
        const clean = String(url || "");
        this.doc.transact(() => {
          this.metaMap.set("background", clean);
        }, ORIGIN_REMOTE);
        this.sendOp({ op: "bg", url: clean });
      },
      onSpriteChange: (sprite) => {
        if (!sprite || !sprite.id) return;
        const key = String(sprite.id);
        const cur = this.spritesMap.get(key);
        const merged = Object.assign({}, cur || {}, sprite);
        if (!merged.angles && cur && cur.angles) merged.angles = cur.angles;
        this.doc.transact(() => {
          this.spritesMap.set(key, merged);
        }, ORIGIN_REMOTE);
        this.sendOp({ op: "sprite-upsert", sprite: merged });
      },
      onSpriteMove: ({ id, x, y }) => {
        if (!id) return;
        const key = String(id);
        const cur = this.spritesMap.get(key);
        const node = this.stage.sprites.get(key);
        const base = Object.assign({}, cur || {}, node ? this.stage.serializeSprite(node) : { id: key });
        if (!base.angles && cur && cur.angles) base.angles = cur.angles;
        const merged = Object.assign({}, base, { x, y });
        this.doc.transact(() => {
          this.spritesMap.set(key, merged);
        }, ORIGIN_REMOTE);
        this.sendOp({ op: "sprite-upsert", sprite: merged });
      },
      onSpriteRemove: (id) => {
        const key = String(id);
        this.doc.transact(() => {
          this.spritesMap.delete(key);
        }, ORIGIN_REMOTE);
        this.sendOp({ op: "sprite-remove", id: key });
      },
      onClearSprites: () => {
        this.doc.transact(() => {
          Array.from(this.spritesMap.keys()).forEach((k) => this.spritesMap.delete(k));
        }, ORIGIN_REMOTE);
        this.sendOp({ op: "sprites-clear" });
      },
    };
  }

  bindDoc() {
    this.doc.on("update", (update, origin) => {
      if (origin === ORIGIN_REMOTE) return;
      const msg = { type: "canvas-yjs", update: Array.from(update) };
      if (network.isHost) {
        broadcast(msg);
      } else {
        sendUpstream(msg);
      }
    });
  }

  syncStageFromDoc() {
    if (!this.stage) return;
    this.stage.setBackground(this.metaMap.get("background") || "", false);
    const currentSprites = new Set(this.stage.sprites.keys());
    this.spritesMap.forEach((data, key) => {
      currentSprites.delete(key);
      if (data) this.stage.upsertSprite(data, false);
    });
    currentSprites.forEach((key) => this.stage.removeSprite(key, false));

    this.stage.interestMarkers.clear();
    this.interestsMap.forEach((marker, key) => {
      if (marker) this.stage.interestMarkers.set(key, marker);
    });
    this.stage.notifyChange();
  }

  handleMessage(data, fromPeerId = null) {
    if (!data) return;
    if (data.type === "canvas-yjs") {
      this.applyRemoteUpdate(data.update, fromPeerId);
      return;
    }
    if (data.type !== "canvas-op") return;

    if (network.isHost && fromPeerId) {
      this.sendOp(data, fromPeerId);
    }

    const op = data.op;
    if (op === "bg") {
      const url = String(data.url || "");
      this.doc.transact(() => this.metaMap.set("background", url), ORIGIN_REMOTE);
      this.stage.setBackground(url, false);
    } else if (op === "sprite-upsert" && data.sprite?.id) {
      const key = String(data.sprite.id);
      const existed = this.stage.sprites.has(key);
      this.doc.transact(() => this.spritesMap.set(key, data.sprite), ORIGIN_REMOTE);
      this.stage.upsertSprite(data.sprite, false).then(() => {
        if (!existed) this.stage.notifyChange();
      });
    } else if (op === "sprite-remove" && data.id) {
      const key = String(data.id);
      this.doc.transact(() => this.spritesMap.delete(key), ORIGIN_REMOTE);
      this.stage.removeSprite(key, false);
    } else if (op === "sprites-clear") {
      this.doc.transact(() => {
        Array.from(this.spritesMap.keys()).forEach((k) => this.spritesMap.delete(k));
      }, ORIGIN_REMOTE);
      this.stage.clearSprites(false);
    } else if (op === "interest-upsert" && data.marker?.id) {
      const key = String(data.marker.id);
      this.doc.transact(() => this.interestsMap.set(key, data.marker), ORIGIN_REMOTE);
      this.stage.interestMarkers.set(key, data.marker);
      this.stage.notifyChange();
    } else if (op === "interest-remove" && data.id) {
      const key = String(data.id);
      this.doc.transact(() => this.interestsMap.delete(key), ORIGIN_REMOTE);
      this.stage.interestMarkers.delete(key);
      this.stage.notifyChange();
    } else if (op === "full-state" && data.state) {
      this.replaceState(data.state, false);
    }
  }

  encodeFullState() {
    return Array.from(Y.encodeStateAsUpdate(this.doc));
  }

  applyRemoteUpdate(updateArray, fromPeerId = null) {
    if (!Array.isArray(updateArray) || !updateArray.length) return;
    try {
      const update = new Uint8Array(updateArray);
      Y.applyUpdate(this.doc, update, ORIGIN_REMOTE);
      this.syncStageFromDoc();
      if (network.isHost && fromPeerId) {
        broadcast({ type: "canvas-yjs", update: updateArray }, fromPeerId);
      }
    } catch (e) {}
  }

  sendFullStateTo(connection) {
    if (!connection || !connection.open) return;
    try {
      const state = this.stage ? this.stage.exportState() : {};
      connection.send({ type: "canvas-op", op: "full-state", state });
    } catch (e) {}
  }

  replaceState(canvasData = {}, emit = true) {
    const bg = typeof canvasData.background === "string" ? canvasData.background : "";
    const sprites = canvasData.sprites && typeof canvasData.sprites === "object" ? canvasData.sprites : {};
    const interests = canvasData.interests && typeof canvasData.interests === "object" ? canvasData.interests : {};
    this.doc.transact(() => {
      this.metaMap.set("background", bg);
      Array.from(this.spritesMap.keys()).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(sprites, k)) this.spritesMap.delete(k);
      });
      Object.keys(sprites).forEach((k) => {
        if (sprites[k]) this.spritesMap.set(String(k), sprites[k]);
      });
      Array.from(this.interestsMap.keys()).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(interests, k)) this.interestsMap.delete(k);
      });
      Object.keys(interests).forEach((k) => {
        if (interests[k]) this.interestsMap.set(String(k), interests[k]);
      });
    }, ORIGIN_REMOTE);
    if (this.stage) this.stage.importState({ background: bg, sprites, interests });
    if (emit) {
      this.sendOp({ op: "full-state", state: { background: bg, sprites, interests } });
    }
  }
}
