// Yjs CRDT synchronization over PeerJS for the Konva background canvas.
import * as Y from "https://esm.sh/yjs@13.6.18";
import { network, broadcast } from "../app/net.js";

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

  bindStage() {
    if (!this.stage) return;
    this.stage.callbacks = {
      onInterestChange: (marker) => {
        if (!marker || !marker.id) return;
        this.doc.transact(() => {
          this.interestsMap.set(String(marker.id), marker);
        });
      },
      onInterestRemove: (id) => {
        if (!id) return;
        this.doc.transact(() => {
          this.interestsMap.delete(String(id));
        });
      },
      onBackgroundChange: (url) => {
        this.doc.transact(() => {
          this.metaMap.set("background", String(url || ""));
        });
      },
      onSpriteChange: (sprite) => {
        if (!sprite || !sprite.id) return;
        const key = String(sprite.id);
        const cur = this.spritesMap.get(key);
        const merged = Object.assign({}, cur || {}, sprite);
        if (!merged.angles && cur && cur.angles) merged.angles = cur.angles;
        this.doc.transact(() => {
          this.spritesMap.set(key, merged);
        });
      },
      onSpriteMove: ({ id, x, y }) => {
        if (!id) return;
        const key = String(id);
        const cur = this.spritesMap.get(key);
        const node = this.stage.sprites.get(key);
        const base = Object.assign({}, cur || {}, node ? this.stage.serializeSprite(node) : { id: key });
        if (!base.angles && cur && cur.angles) base.angles = cur.angles;
        this.doc.transact(() => {
          this.spritesMap.set(key, Object.assign({}, base, { x, y }));
        });
      },
      onSpriteRemove: (id) => {
        this.doc.transact(() => {
          this.spritesMap.delete(String(id));
        });
      },
      onClearSprites: () => {
        this.doc.transact(() => {
          Array.from(this.spritesMap.keys()).forEach((k) => this.spritesMap.delete(k));
        });
      },
    };
  }

  bindDoc() {
    this.interestsMap.observe((event) => {
      event.keysChanged.forEach((key) => {
        const marker = this.interestsMap.get(key);
        if (marker) this.stage.interestMarkers.set(key, marker);
        else this.stage.interestMarkers.delete(key);
      });
      this.stage.notifyChange();
    });

    this.doc.on("update", (update, origin) => {
      if (origin === ORIGIN_REMOTE) return;
      const msg = { type: "canvas-yjs", update: Array.from(update) };
      if (network.isHost) {
        broadcast(msg);
      } else if (network.upstream && network.upstream.open) {
        try {
          network.upstream.send(msg);
        } catch (e) {}
      }
    });

    this.metaMap.observe((event) => {
      if (event.transaction.origin === ORIGIN_REMOTE) {
        this.stage.setBackground(this.metaMap.get("background") || "", false);
      }
    });

    this.spritesMap.observe((event) => {
      if (event.transaction.origin === ORIGIN_REMOTE) {
        event.keysChanged.forEach((key) => {
          const change = event.changes.keys.get(key);
          if (change && change.action === "delete") {
            this.stage.removeSprite(key, false);
          } else {
            const data = this.spritesMap.get(key);
            if (data) this.stage.upsertSprite(data, false);
          }
        });
      }
    });
  }

  encodeFullState() {
    return Array.from(Y.encodeStateAsUpdate(this.doc));
  }

  applyRemoteUpdate(updateArray, fromPeerId = null) {
    if (!Array.isArray(updateArray) || !updateArray.length) return;
    try {
      const update = new Uint8Array(updateArray);
      Y.applyUpdate(this.doc, update, ORIGIN_REMOTE);
      if (network.isHost && fromPeerId) {
        broadcast({ type: "canvas-yjs", update: updateArray }, fromPeerId);
      }
    } catch (e) {}
  }

  sendFullStateTo(connection) {
    if (!connection || !connection.open) return;
    try {
      connection.send({ type: "canvas-yjs", update: this.encodeFullState() });
    } catch (e) {}
  }

  replaceState(canvasData = {}, emit = true) {
    const bg = typeof canvasData.background === "string" ? canvasData.background : "";
    const sprites = canvasData.sprites && typeof canvasData.sprites === "object" ? canvasData.sprites : {};
    const interests = canvasData.interests && typeof canvasData.interests === "object" ? canvasData.interests : {};
    const origin = emit ? "session-load" : ORIGIN_REMOTE;
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
    }, origin);
    if (this.stage) this.stage.importState({ background: bg, sprites, interests });
  }
}
