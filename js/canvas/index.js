// Entry module for the Konva background canvas and Yjs PeerJS sync.
import { CanvasStage } from "./stage.js";
import { CanvasSync } from "./sync.js";
import { initCanvasControls } from "./controls.js";

let instance = null;
let syncInstance = null;

export function initCanvas(callbacks = {}) {
  if (!instance) {
    instance = new CanvasStage("bg-canvas", callbacks);
    syncInstance = new CanvasSync(instance);
    initCanvasControls(instance);
  }
  return instance;
}

export function getCanvas() {
  return instance;
}

export function getCanvasSync() {
  return syncInstance;
}
