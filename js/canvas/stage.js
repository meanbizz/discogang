// Konva 2D background stage and sprite manager.

import { state } from "../app/state.js";

export class CanvasStage {
  constructor(containerId = "bg-canvas", callbacks = {}) {
    this.container = document.getElementById(containerId);
    this.callbacks = callbacks;
    this.stage = null;
    this.bgLayer = null;
    this.spriteLayer = null;
    this.bgNode = null;
    this.bgImage = null;
    this.bgUrl = "";
    this.sprites = new Map();
    this.interestNodes = new Map();
    this.imageCache = new Map();
    this.transformer = null;
    this.selectedId = null;
    this.listeners = new Set();
    this.panEnabled = false;
    this._bgDragging = false;
    this._lastClientX = 0;
    this._lastClientY = 0;
    this.zoom = 1;
    this.minZoom = 0.25;
    this.maxZoom = 1;
    this._pinchDist = 0;

    if (this.container && window.Konva) {
      this.init();
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyChange() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {}
    });
  }

  init() {
    this.stage = new window.Konva.Stage({
      container: this.container,
      width: window.innerWidth,
      height: window.innerHeight,
    });

    this.bgLayer = new window.Konva.Layer();
    this.spriteLayer = new window.Konva.Layer();

    this.bgNode = new window.Konva.Image({
      x: 0,
      y: 0,
      width: this.stage.width(),
      height: this.stage.height(),
    });

    this.transformer = new window.Konva.Transformer({
      keepRatio: false,
      rotateEnabled: true,
      enabledAnchors: [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
        "middle-left",
        "middle-right",
        "top-center",
        "bottom-center",
      ],
    });

    this.bgLayer.add(this.bgNode);
    this.spriteLayer.add(this.transformer);
    this.stage.add(this.bgLayer);
    this.stage.add(this.spriteLayer);

    this.stage.on("click tap", (e) => {
      if (e.target === this.stage || e.target === this.bgNode) {
        this.selectSprite(null);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
        if (this.selectedId) this.removeSprite(this.selectedId, true);
        return;
      }
      if (!this.panEnabled) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      if (document.querySelector(".modal:not([hidden])")) return;
      const step = e.shiftKey ? 160 : 80;
      let dx = 0, dy = 0;
      if (e.key === "ArrowUp") dy = step;
      else if (e.key === "ArrowDown") dy = -step;
      else if (e.key === "ArrowLeft") dx = step;
      else if (e.key === "ArrowRight") dx = -step;
      else return;
      e.preventDefault();
      this.panBy(dx, dy);
    });

    // Background drag when UI is hidden
    this.stage.on("mousedown touchstart", (e) => {
      if (!this.panEnabled) return;
      if (e.target !== this.stage && e.target !== this.bgNode) return;
      const evt = e.evt;
      if (evt.button !== undefined && evt.button !== 0) return;
      const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const cy = evt.touches ? evt.touches[0].clientY : evt.clientY;
      this._bgDragging = true;
      this._lastClientX = cx;
      this._lastClientY = cy;
    });

    window.addEventListener("mousemove", (e) => {
      if (!this._bgDragging || !this.panEnabled) return;
      const dx = e.clientX - this._lastClientX;
      const dy = e.clientY - this._lastClientY;
      this._lastClientX = e.clientX;
      this._lastClientY = e.clientY;
      this.panBy(dx, dy);
    });

    window.addEventListener("touchmove", (e) => {
      if (!this._bgDragging || !this.panEnabled) return;
      if (!e.touches[0]) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - this._lastClientX;
      const dy = e.touches[0].clientY - this._lastClientY;
      this._lastClientX = e.touches[0].clientX;
      this._lastClientY = e.touches[0].clientY;
      this.panBy(dx, dy);
    }, { passive: false });

    window.addEventListener("mouseup", () => { this._bgDragging = false; });
    window.addEventListener("touchend", () => { this._bgDragging = false; this._pinchDist = 0; });
    window.addEventListener("touchcancel", () => { this._bgDragging = false; this._pinchDist = 0; });
    this.container.addEventListener("wheel", (e) => {
      if (!this.panEnabled) return;
      if (document.querySelector(".modal:not([hidden])")) return;
      e.preventDefault();
      const d = e.deltaY > 0 ? -0.05 : 0.05;
      this.setZoom(this.zoom + d, e.clientX, e.clientY);
    }, { passive: false });
    this.stage.on("touchmove", (e) => {
      const t = e.evt.touches;
      if (!this.panEnabled || !t || t.length !== 2) return;
      e.evt.preventDefault();
      const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (!this._pinchDist) { this._pinchDist = dist; return; }
      const cx = (t[0].clientX + t[1].clientX) / 2, cy = (t[0].clientY + t[1].clientY) / 2;
      this.setZoom(this.zoom * (dist / this._pinchDist), cx, cy);
      this._pinchDist = dist;
    });
    this.stage.on("touchend touchcancel", () => { this._pinchDist = 0; });

    window.addEventListener("resize", () => this.resize());
  }

  viewportCenter() {
    if (!this.stage) return { x: 0, y: 0 };
    return this.stage.getAbsoluteTransform().copy().invert().point({
      x: this.stage.width() / 2,
      y: this.stage.height() / 2,
    });
  }

  renderInterestMarkers(markers, colors) {
    if (!this.spriteLayer) return;
    this.interestNodes.forEach((node, id) => {
      if (!markers.has(id)) {
        node.destroy();
        this.interestNodes.delete(id);
      }
    });
    markers.forEach((data, id) => {
      if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      let node = this.interestNodes.get(id);
      if (!node) {
        node = new window.Konva.Group({ draggable: true });
        node.add(new window.Konva.Circle({ radius: 12 }));
        node.add(new window.Konva.Circle({
          radius: 4,
          fill: "#fff",
          listening: false,
        }));
        node.add(new window.Konva.Text({
          x: 20,
          y: -7,
          fontSize: 14,
          fill: "#fff",
          shadowColor: "#000",
          shadowBlur: 3,
          listening: false,
        }));
        node.on("click tap", (event) => {
          event.cancelBubble = true;
        });
        node.on("dragstart", () => {
          if (!state.isAdmin) node.stopDrag();
        });
        node.on("dragmove dragend", () => {
          if (!state.isAdmin) return;
          const current = this.interestMarkers?.get(id);
          if (current && this.callbacks.onInterestChange) {
            this.callbacks.onInterestChange({
              ...current,
              x: node.x(),
              y: node.y(),
            });
          }
        });
        this.interestNodes.set(id, node);
        this.spriteLayer.add(node);
      }
      node.getChildren()[0].fill(colors[data.attribute] || "#8a8f98");
      node.getChildren()[2].text(data.name || "Spot of interest");
      if (!node.isDragging()) node.position({ x: data.x, y: data.y });
    });
    if (this.transformer) this.transformer.moveToTop();
    this.spriteLayer.batchDraw();
  }

  selectSprite(id) {
    if (!this.transformer) return;
    const key = id ? String(id) : null;
    const node = key ? this.sprites.get(key) : null;
    this.selectedId = node ? key : null;
    this.transformer.nodes(node ? [node] : []);
    if (node) this.transformer.moveToTop();
    this.spriteLayer.batchDraw();
  }

  clampPos(pos) {
    return pos;
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = this.bgNode.width() * this.zoom, bh = this.bgNode.height() * this.zoom;
    let x = pos.x, y = pos.y;
    if (bw <= vw) x = (vw - bw) / 2; else x = Math.max(vw - bw, Math.min(0, x));
    if (bh <= vh) y = (vh - bh) / 2; else y = Math.max(vh - bh, Math.min(0, y));
    return { x, y };
  }
  applyTransform() {
    if (!this.stage) return;
    this.stage.scale({ x: this.zoom, y: this.zoom });
    const p = this.clampPos(this.stage.position());
    this.stage.position(p);
    this.stage.batchDraw();
  }
  panBy(dx, dy) {
    if (!this.stage) return;
    const p = this.clampPos({ x: this.stage.x() + (Number(dx) || 0), y: this.stage.y() + (Number(dy) || 0) });
    this.stage.position(p);
    this.stage.batchDraw();
  }
  resetPan() {
    if (!this.stage) return;
    this.zoom = 1;
    this.applyTransform();
    const p = this.clampPos({ x: 0, y: 0 });
    this.stage.position(p);
    this.stage.batchDraw();
  }
  setZoom(next, cx, cy) {
    if (!this.stage) return;
    const z = Math.max(this.minZoom, Math.min(this.maxZoom, next));
    if (z === this.zoom) return;
    const old = this.zoom;
    const stagePos = this.stage.position();
    const wx = (cx - stagePos.x) / old, wy = (cy - stagePos.y) / old;
    this.zoom = z;
    const nx = cx - wx * z, ny = cy - wy * z;
    this.stage.scale({ x: z, y: z });
    this.stage.position(this.clampPos({ x: nx, y: ny }));
    this.stage.batchDraw();
  }

  resize() {
    if (!this.stage) return;
    this.stage.width(window.innerWidth);
    this.stage.height(window.innerHeight);
    this.fitBackground();
    this.bgLayer.batchDraw();
  }

  loadImage(url) {
    if (this.imageCache.has(url)) {
      return Promise.resolve(this.imageCache.get(url));
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  fitBackground() {
    if (!this.bgNode || !this.bgImage || !this.stage) return;
    const sw = this.stage.width();
    const sh = this.stage.height();
    const iw = this.bgImage.naturalWidth || this.bgImage.width || 1;
    const ih = this.bgImage.naturalHeight || this.bgImage.height || 1;
    const scale = Math.max(sw / iw, sh / ih);
    const w = iw * scale;
    const h = ih * scale;

    this.bgNode.width(w);
    this.bgNode.height(h);
    this.bgNode.x((sw - w) / 2);
    this.bgNode.y((sh - h) / 2);
  }

  async setBackground(url, emit = true) {
    if (!this.stage) return;
    const cleanUrl = String(url || "").trim();
    this.bgUrl = cleanUrl;

    if (!cleanUrl) {
      this.bgImage = null;
      this.bgNode.image(null);
      this.bgLayer.batchDraw();
      this.notifyChange();
      if (emit && this.callbacks.onBackgroundChange) {
        this.callbacks.onBackgroundChange("");
      }
      return;
    }

    try {
      const img = await this.loadImage(cleanUrl);
      if (this.bgUrl !== cleanUrl) return;
      this.bgImage = img;
      this.bgNode.image(img);
      this.fitBackground();
      this.bgLayer.batchDraw();
      this.notifyChange();
      if (emit && this.callbacks.onBackgroundChange) {
        this.callbacks.onBackgroundChange(cleanUrl);
      }
    } catch (error) {}
  }

  async upsertSprite(data, emit = true) {
    if (!this.stage || !data || !data.id) return;
    const id = String(data.id);
    const existing = this.sprites.get(id);

    if (existing) {
      this.updateSpriteNode(existing, data);
      if (emit && this.callbacks.onSpriteChange) {
        this.callbacks.onSpriteChange(this.serializeSprite(existing));
      }
      return;
    }

    if (!data.url) return;
    try {
      const img = await this.loadImage(data.url);
      if (this.sprites.has(id)) {
        this.updateSpriteNode(this.sprites.get(id), data);
        return;
      }

      const node = new window.Konva.Image({
        id,
        image: img,
        x: Number.isFinite(Number(data.x)) ? Number(data.x) : 100,
        y: Number.isFinite(Number(data.y)) ? Number(data.y) : 100,
        width: Number(data.width) || img.naturalWidth || 120,
        height: Number(data.height) || img.naturalHeight || 120,
        scaleX: Number(data.scaleX) || 1,
        scaleY: Number(data.scaleY) || 1,
        rotation: Number(data.rotation) || 0,
        draggable: data.draggable !== false,
      });

      node.setAttr("spriteUrl", data.url);
      node.setAttr("spriteName", data.name || "");
      node.setAttr("zIndexOrder", Number(data.zIndex) || 0);

      node.on("click tap", (e) => {
        e.cancelBubble = true;
        this.selectSprite(id);
      });

      node.on("dragstart", () => {
        node.moveToTop();
        if (this.transformer) this.transformer.moveToTop();
        this.spriteLayer.batchDraw();
      });

      node.on("dragmove", () => {
        if (this.callbacks.onSpriteMove) {
          this.callbacks.onSpriteMove({
            id,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
          });
        }
      });

      node.on("dragend transformend", () => {
        if (this.callbacks.onSpriteChange) {
          this.callbacks.onSpriteChange(this.serializeSprite(node));
        }
        this.notifyChange();
      });

      this.sprites.set(id, node);
      this.spriteLayer.add(node);
      if (this.transformer) this.transformer.moveToTop();
      this.spriteLayer.batchDraw();
      this.notifyChange();

      if (emit && this.callbacks.onSpriteChange) {
        this.callbacks.onSpriteChange(this.serializeSprite(node));
      }
    } catch (error) {}
  }

  updateSpriteNode(node, data) {
    if (data.x !== undefined) node.x(Number(data.x) || 0);
    if (data.y !== undefined) node.y(Number(data.y) || 0);
    if (data.width !== undefined) node.width(Number(data.width) || node.width());
    if (data.height !== undefined) node.height(Number(data.height) || node.height());
    if (data.scaleX !== undefined) node.scaleX(Number(data.scaleX) || 1);
    if (data.scaleY !== undefined) node.scaleY(Number(data.scaleY) || 1);
    if (data.rotation !== undefined) node.rotation(Number(data.rotation) || 0);
    if (data.draggable !== undefined) node.draggable(Boolean(data.draggable));
    if (data.name !== undefined) node.setAttr("spriteName", String(data.name || ""));
    if (data.url && data.url !== node.getAttr("spriteUrl")) {
      node.setAttr("spriteUrl", data.url);
      this.loadImage(data.url)
        .then((img) => {
          node.image(img);
          this.spriteLayer.batchDraw();
        })
        .catch(() => {});
    }
    this.spriteLayer.batchDraw();
    this.notifyChange();
  }

  moveSprite(id, x, y, emit = false) {
    const node = this.sprites.get(String(id));
    if (!node) return;
    node.position({ x: Number(x) || 0, y: Number(y) || 0 });
    this.spriteLayer.batchDraw();
    if (emit && this.callbacks.onSpriteMove) {
      this.callbacks.onSpriteMove({ id: String(id), x: node.x(), y: node.y() });
    }
  }

  removeSprite(id, emit = true) {
    const key = String(id);
    const node = this.sprites.get(key);
    if (!node) return;
    if (this.selectedId === key) this.selectSprite(null);
    node.destroy();
    this.sprites.delete(key);
    this.spriteLayer.batchDraw();
    this.notifyChange();
    if (emit && this.callbacks.onSpriteRemove) {
      this.callbacks.onSpriteRemove(key);
    }
  }

  clearSprites(emit = true) {
    this.selectSprite(null);
    this.sprites.forEach((node) => node.destroy());
    this.sprites.clear();
    if (this.spriteLayer) this.spriteLayer.batchDraw();
    this.notifyChange();
    if (emit && this.callbacks.onClearSprites) {
      this.callbacks.onClearSprites();
    }
  }

  serializeSprite(node) {
    return {
      id: node.id(),
      name: node.getAttr("spriteName") || "",
      url: node.getAttr("spriteUrl") || "",
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      width: Math.round(node.width()),
      height: Math.round(node.height()),
      scaleX: Number(node.scaleX().toFixed(3)),
      scaleY: Number(node.scaleY().toFixed(3)),
      rotation: Math.round(node.rotation()),
      draggable: node.draggable(),
    };
  }

  exportState() {
    const sprites = {};
    this.sprites.forEach((node, id) => {
      sprites[id] = this.serializeSprite(node);
    });
    return {
      background: this.bgUrl,
      sprites,
    };
  }

  async importState(state = {}) {
    await this.setBackground(state.background || "", false);
    const incoming = state.sprites && typeof state.sprites === "object" ? state.sprites : {};
    const incomingIds = new Set(Object.keys(incoming));

    Array.from(this.sprites.keys()).forEach((id) => {
      if (!incomingIds.has(id)) this.removeSprite(id, false);
    });

    const entries = Object.values(incoming);
    for (let i = 0; i < entries.length; i += 1) {
      await this.upsertSprite(entries[i], false);
    }
  }
}
