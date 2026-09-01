/* Entry point. Wires the timings onto :root, pulls the cues into memory,
   registers the network handlers and the listeners, and paints the idle
   interface. Everything it calls lives in js/app/. */

import { dom } from "./dom.js";
import { applyTiming } from "./timing.js";
import * as vitals from "./vitals.js";
import * as cues from "./dialogue/cues.js";
import "./app/handlers.js";
import { bindJoin } from "./app/join.js";
import { bindSession } from "./app/events.js";
import {
  paintReadyButton,
  renderTurnEmptyState,
  setStatus,
} from "./app/views.js";
import {
  refreshLoadButton,
  refreshPlanningLock,
  refreshSpeakLock,
} from "./app/locks.js";
import { renderScene } from "./app/scene.js";

(function bootstrap() {
  /* Timings first, so the stylesheet and the JS timers agree from the very
     first frame. */
  applyTiming();
  /* Cues and verdict art into memory now, so a roll never waits on a fetch. */
  cues.preloadAll();

  bindJoin();
  bindSession();

  vitals.refreshVitals(null, true);
  renderScene();
  renderTurnEmptyState();
  paintReadyButton();
  refreshPlanningLock();
  refreshSpeakLock();
  refreshLoadButton();
  dom.nameInput.focus();
  setStatus("offline", "Offline");
})();
