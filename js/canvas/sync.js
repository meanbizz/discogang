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
    this.bindStage();
    this.bindDoc();
  }

  bindStage() {
    if (!this.stage) return;
    this.stage.callbacks = {
      onBackgroundChange: (url) => {
        this.doc.transact(() => {
          this.metaMap.set("background", String(url || ""));
        });
      },
      onSpriteChange: (sprite) => {
        if (!sprite || !sprite.id) return;
        this.doc.transact(() => {
          this.spritesMap.set(String(sprite.id), sprite);
        });
      },
      onSpriteMove: ({ id, x, y }) => {
        if (!id) return;
        const key = String(id);
        const cur = this.spritesMap.get(key);
        const node = this.stage.sprites.get(key);
        const base = cur || (node ? this.stage.serializeSprite(node) : { id: key });
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
}
