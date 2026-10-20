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
    this.angleControls = null;
    this.selectedId = null;
    this.listeners = new Set();
    this.panEnabled = false;
    this._bgDragging = false;
    this._lastClientX = 0;
    this._lastClientY = 0;
    this.baseWidth = 1920;
    this.baseHeight = 1080;
    this.baseScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.minZoom = 0.25;
    this.maxZoom = 2;
    this._pinchDist = 0;

    if (this.container && window.Konva) {
      this.init();
    }
  }

  setInteractive(enabled) {
    this.panEnabled = Boolean(enabled);
    if (!this.panEnabled) this.selectSprite(null);
    this.sprites.forEach((node) => {
      node.draggable(this.panEnabled && node.getAttr("spriteDraggable") !== false);
    });
    this.interestNodes.forEach((node) => {
      node.draggable(this.panEnabled && Boolean(state.isAdmin));
    });
    if (this.spriteLayer) this.spriteLayer.batchDraw();
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
      width: this.baseWidth,
      height: this.baseHeight,
    });

    this.transformer = new window.Konva.Transformer({
      keepRatio: true,
      rotateEnabled: true,
      enabledAnchors: [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ],
    });

    this.angleControls = new window.Konva.Group({ visible: false });
    const corners = [
      { key: "tl", label: "↖" },
      { key: "tr", label: "↗" },
      { key: "bl", label: "↙" },
      { key: "br", label: "↘" },
    ];
    corners.forEach(({ key, label }) => {
      const btn = new window.Konva.Group({ name: `angle-${key}` });
      btn.add(
        new window.Konva.Circle({
          radius: 11,
          fill: "rgba(20, 20, 24, 0.85)",
          stroke: "#d9a441",
          strokeWidth: 1.5,
        }),
      );
      btn.add(
        new window.Konva.Text({
          text: label,
          fontSize: 13,
          fill: "#fff",
          x: -6,
          y: -6,
          listening: false,
        }),
      );
      btn.on("click tap", (e) => {
        e.cancelBubble = true;
        this.switchSelectedSpriteAngle(key);
      });
      this.angleControls.add(btn);
    });

    this.bgLayer.add(this.bgNode);
    this.spriteLayer.add(this.transformer);
    this.spriteLayer.add(this.angleControls);
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
    this.resize();
  }

  viewportCenter() {
    if (!this.stage) return { x: this.baseWidth / 2, y: this.baseHeight / 2 };
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
        node = new window.Konva.Group({ draggable: this.panEnabled && Boolean(state.isAdmin) });
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
          if (!state.isAdmin || !this.panEnabled) node.stopDrag();
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

  updateAngleControls() {
    if (!this.angleControls) return;
    const node = this.selectedId ? this.sprites.get(this.selectedId) : null;
    const angles = node ? (node._spriteAngles || node.getAttr("spriteAngles")) : null;
    if (!node || !angles || typeof angles !== "object" || !Object.keys(angles).length) {
      this.angleControls.visible(false);
      return;
    }
    const tr = node.getTransform();
    const w = node.width();
    const h = node.height();
    const offset = 22;
    const pts = {
      tl: tr.point({ x: 0, y: 0 }),
      tr: tr.point({ x: w, y: 0 }),
      bl: tr.point({ x: 0, y: h }),
      br: tr.point({ x: w, y: h }),
    };
    const center = tr.point({ x: w / 2, y: h / 2 });
    ["tl", "tr", "bl", "br"].forEach((k) => {
      const btn = this.angleControls.findOne(`.angle-${k}`);
      if (!btn) return;
      const dx = pts[k].x - center.x;
      const dy = pts[k].y - center.y;
      const len = Math.hypot(dx, dy) || 1;
      btn.position({
        x: pts[k].x + (dx / len) * offset,
        y: pts[k].y + (dy / len) * offset,
      });
    });
    this.angleControls.visible(true);
    this.angleControls.moveToTop();
  }

  switchSelectedSpriteAngle(cornerKey) {
    const node = this.selectedId ? this.sprites.get(this.selectedId) : null;
    if (!node) return;
    const angles = node._spriteAngles || node.getAttr("spriteAngles");
    if (!angles) return;
    const opp = { tl: "tr", tr: "tl", bl: "br", br: "bl" }[cornerKey];
    const nextUrl = angles[cornerKey] || angles[opp];
    const flip = !angles[cornerKey] && Boolean(angles[opp]);
    if (!nextUrl || (nextUrl === node.getAttr("spriteUrl") && flip === Boolean(node._spriteFlipX))) return;
    node.setAttr("spriteUrl", nextUrl);
    node._spriteFlipX = flip;
    node.setAttr("spriteFlipX", flip);
    this.loadImage(nextUrl, flip)
      .then((img) => {
        node.image(img);
        this.spriteLayer.batchDraw();
        if (this.callbacks.onSpriteChange) {
          this.callbacks.onSpriteChange(this.serializeSprite(node));
        }
        this.notifyChange();
      })
      .catch(() => {});
  }

  selectSprite(id) {
    if (!this.transformer) return;
    if (!this.panEnabled && id) return;
    const key = id ? String(id) : null;
    const node = key ? this.sprites.get(key) : null;
    this.selectedId = node ? key : null;
    this.transformer.nodes(node ? [node] : []);
    if (node) this.transformer.moveToTop();
    this.updateAngleControls();
    this.spriteLayer.batchDraw();
  }

  applyTransform() {
    if (!this.stage) return;
    const sw = this.stage.width();
    const sh = this.stage.height();
    this.baseScale = Math.max(sw / this.baseWidth, sh / this.baseHeight);
    const scale = this.baseScale * this.zoom;
    const cx = (sw - this.baseWidth * scale) / 2;
    const cy = (sh - this.baseHeight * scale) / 2;
    this.stage.scale({ x: scale, y: scale });
    this.stage.position({
      x: cx + this.panX * this.baseScale,
      y: cy + this.panY * this.baseScale,
    });
    this.stage.batchDraw();
  }
  panBy(dx, dy) {
    if (!this.stage) return;
    const bs = this.baseScale || 1;
    this.panX += (Number(dx) || 0) / bs;
    this.panY += (Number(dy) || 0) / bs;
    this.applyTransform();
  }
  resetPan() {
    if (!this.stage) return;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }
  setZoom(next, cx, cy) {
    if (!this.stage) return;
    const z = Math.max(this.minZoom, Math.min(this.maxZoom, next));
    if (z === this.zoom) return;
    const sw = this.stage.width();
    const sh = this.stage.height();
    const bs = this.baseScale || 1;
    const oldScale = bs * this.zoom;
    const stagePos = this.stage.position();
    const wx = (cx - stagePos.x) / oldScale;
    const wy = (cy - stagePos.y) / oldScale;
    this.zoom = z;
    const newScale = bs * z;
    const nx = cx - wx * newScale;
    const ny = cy - wy * newScale;
    const baseCx = (sw - this.baseWidth * newScale) / 2;
    const baseCy = (sh - this.baseHeight * newScale) / 2;
    this.panX = (nx - baseCx) / bs;
    this.panY = (ny - baseCy) / bs;
    this.applyTransform();
  }

  resize() {
    if (!this.stage) return;
    this.stage.width(window.innerWidth);
    this.stage.height(window.innerHeight);
    this.fitBackground();
    this.applyTransform();
  }

  loadImage(url, flip = false) {
    const key = flip ? `${url}#flip` : url;
    if (this.imageCache.has(key)) {
      return Promise.resolve(this.imageCache.get(key));
    }
    if (flip) {
      return this.loadImage(url, false).then((img) => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width || 1;
        c.height = img.naturalHeight || img.height || 1;
        const ctx = c.getContext("2d");
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        this.imageCache.set(key, c);
        return c;
      });
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
    if (!this.bgNode) return;
    if (!this.bgImage) {
      this.baseWidth = 1920;
      this.baseHeight = 1080;
    } else {
      this.baseWidth = this.bgImage.naturalWidth || this.bgImage.width || 1920;
      this.baseHeight = this.bgImage.naturalHeight || this.bgImage.height || 1080;
    }
    this.bgNode.x(0);
    this.bgNode.y(0);
    this.bgNode.width(this.baseWidth);
    this.bgNode.height(this.baseHeight);
  }

  async setBackground(url, emit = true) {
    if (!this.stage) return;
    const cleanUrl = String(url || "").trim();
    this.bgUrl = cleanUrl;

    if (!cleanUrl) {
      this.bgImage = null;
      this.bgNode.image(null);
      this.fitBackground();
      this.applyTransform();
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
      this.applyTransform();
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
      const img = await this.loadImage(data.url, Boolean(data.flipX));
      if (this.sprites.has(id)) {
        this.updateSpriteNode(this.sprites.get(id), data);
        return;
      }

      const nw = img.naturalWidth || img.width || 120;
      const nh = img.naturalHeight || img.height || 120;
      const baseSize = 120;
      const ratio = nw / nh;
      const defaultW = ratio >= 1 ? baseSize : Math.round(baseSize * ratio);
      const defaultH = ratio >= 1 ? Math.round(baseSize / ratio) : baseSize;

      const canDrag = data.draggable !== false;
      const node = new window.Konva.Image({
        id,
        image: img,
        x: Number.isFinite(Number(data.x)) ? Number(data.x) : 100,
        y: Number.isFinite(Number(data.y)) ? Number(data.y) : 100,
        width: Number(data.width) || defaultW,
        height: Number(data.height) || defaultH,
        scaleX: Number(data.scaleX) || 1,
        scaleY: Number(data.scaleY) || 1,
        rotation: Number(data.rotation) || 0,
        draggable: this.panEnabled && canDrag,
      });

      const cleanAngles = data.angles && typeof data.angles === "object" && Object.keys(data.angles).length ? Object.assign({}, data.angles) : null;
      node.setAttr("spriteDraggable", canDrag);
      node.setAttr("spriteUrl", data.url);
      node._spriteFlipX = Boolean(data.flipX);
      node.setAttr("spriteFlipX", Boolean(data.flipX));
      node.setAttr("spriteName", data.name || "");
      node._spriteAngles = cleanAngles;
      node.setAttr("spriteAngles", cleanAngles);
      node.setAttr("zIndexOrder", Number(data.zIndex) || 0);

      node.on("click tap", (e) => {
        if (!this.panEnabled) return;
        e.cancelBubble = true;
        this.selectSprite(id);
      });

      node.on("dragstart", () => {
        if (!this.panEnabled) {
          node.stopDrag();
          return;
        }
        node.moveToTop();
        if (this.transformer) this.transformer.moveToTop();
        if (this.angleControls) this.angleControls.moveToTop();
        this.spriteLayer.batchDraw();
      });

      node.on("dragmove transform", () => {
        if (this.selectedId === id) this.updateAngleControls();
        if (node.isDragging() && this.callbacks.onSpriteMove) {
          this.callbacks.onSpriteMove({
            id,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
          });
        }
      });

      node.on("dragend transformend", () => {
        if (this.selectedId === id) this.updateAngleControls();
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
    if (data.draggable !== undefined) {
      const canDrag = Boolean(data.draggable);
      node.setAttr("spriteDraggable", canDrag);
      node.draggable(this.panEnabled && canDrag);
    }
    if (data.name !== undefined) node.setAttr("spriteName", String(data.name || ""));
    if (data.angles && typeof data.angles === "object" && Object.keys(data.angles).length) {
      const cleanAngles = Object.assign({}, data.angles);
      node._spriteAngles = cleanAngles;
      node.setAttr("spriteAngles", cleanAngles);
    }
    const nextFlip = data.flipX !== undefined ? Boolean(data.flipX) : Boolean(node._spriteFlipX);
    const nextUrl = data.url || node.getAttr("spriteUrl");
    if (nextUrl && (nextUrl !== node.getAttr("spriteUrl") || nextFlip !== Boolean(node._spriteFlipX))) {
      node.setAttr("spriteUrl", nextUrl);
      node._spriteFlipX = nextFlip;
      node.setAttr("spriteFlipX", nextFlip);
      this.loadImage(nextUrl, nextFlip)
        .then((img) => {
          node.image(img);
          this.spriteLayer.batchDraw();
        })
        .catch(() => {});
    }
    if (this.selectedId === node.id()) this.updateAngleControls();
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
    const angles = node._spriteAngles || node.getAttr("spriteAngles") || null;
    return {
      id: node.id(),
      name: node.getAttr("spriteName") || "",
      url: node.getAttr("spriteUrl") || "",
      flipX: Boolean(node._spriteFlipX ?? node.getAttr("spriteFlipX")),
      angles: angles && typeof angles === "object" && Object.keys(angles).length ? Object.assign({}, angles) : null,
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      width: Math.round(node.width()),
      height: Math.round(node.height()),
      scaleX: Number(node.scaleX().toFixed(3)),
      scaleY: Number(node.scaleY().toFixed(3)),
      rotation: Math.round(node.rotation()),
      draggable: node.getAttr("spriteDraggable") !== false,
    };
  }

  exportState() {
    const sprites = {};
    this.sprites.forEach((node, id) => {
      sprites[id] = this.serializeSprite(node);
    });
    const interests = {};
    if (this.interestMarkers) {
      this.interestMarkers.forEach((marker, id) => {
        if (marker) interests[id] = Object.assign({}, marker);
      });
    }
    return {
      background: this.bgUrl,
      sprites,
      interests,
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

    if (this.interestMarkers) {
      this.interestMarkers.clear();
      const incomingInterests = state.interests && typeof state.interests === "object" ? state.interests : {};
      Object.keys(incomingInterests).forEach((id) => {
        const m = incomingInterests[id];
        if (m) this.interestMarkers.set(String(id), Object.assign({}, m));
      });
    }
    this.notifyChange();
  }
}
