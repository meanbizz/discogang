/* js/vitals.js */

/* Health and morale: the two bars, their ceilings taken from the skill sheet,
   and the single-step changes a dialogue node spends. The is-hit flash is
   animated in animations.css.

   The arithmetic itself lives in js/sheet.js, so the save writer and the sheet
   header read the same numbers this does.

   Nothing here is seen the moment it happens. The flash goes through the
   animation lane, so a bar moving under a node that also rolls is seen after
   the dice rather than behind them, and the plate that announces the step is
   queued on the same lane by js/overlays.js. Only refreshVitals is silent: a
   raised ceiling is bookkeeping, not damage. */

import { dom } from "./dom.js";
import { VITAL_SKILL } from "./config.js";
import { TIMING } from "./timing.js";
import { skillScores } from "./sheet.js";
import { whenIdle } from "./sequencer.js";
import * as overlays from "./overlays.js";

export const vitals = {
  health: { value: 0, max: 0 },
  morale: { value: 0, max: 0 },
};

const FLASH_CLEAR_MS = TIMING.vitals.flashMs + TIMING.vitals.clearBufferMs;
const flashTimers = {};

/* Told when a bar is emptied, when both are above water again, and whenever
   the bars move at all; asked whether this seat is down or dead. */
let hooks = {
  onEmpty: null,
  onStand: null,
  onMove: null,
  floored: null,
  dead: null,
};

export function setVitalsHooks(next) {
  hooks = Object.assign(
    { onEmpty: null, onStand: null, onMove: null, floored: null, dead: null },
    next || {},
  );
}

function floored() {
  return Boolean(hooks.floored && hooks.floored());
}

/* Both bars carry at least one step: nothing about this seat is on the floor. */
function standing() {
  return vitals.health.value >= 1 && vitals.morale.value >= 1;
}

/* What is currently working on this seat. Held here because the two ceilings
   are read off endurance and volition, so a modifier moves them with it. */
let modifiers = null;

export function setVitalsModifiers(next) {
  modifiers = next || null;
}

/* One skill's score, or 1 when there is no sheet to read it off. */
export function skillScore(sheetState, skillId, active) {
  const scores = skillScores(
    sheetState,
    active === undefined ? modifiers : active,
  );
  return Object.prototype.hasOwnProperty.call(scores, skillId)
    ? scores[skillId]
    : 1;
}

export function vitalMax(sheetState, kind) {
  return skillScore(sheetState, VITAL_SKILL[kind]) + 1;
}

/* One bar, painted from a value and a ceiling — also how the administrateur
   sees the rest of the table's bars in the roster. */
export function paintVitalBar(element, label, filled, total) {
  if (!element) return;
  element.textContent = "";
  for (let i = 0; i < total; i += 1) {
    const step = document.createElement("span");
    step.className = "vital-step";
    if (i < filled) step.setAttribute("data-filled", "true");
    element.appendChild(step);
  }
  element.setAttribute("aria-label", `${label} ${filled} of ${total}`);
}

export function renderVitals() {
  paintVitalBar(
    dom.healthBar,
    "Health",
    vitals.health.value,
    vitals.health.max,
  );
  paintVitalBar(
    dom.moraleBar,
    "Morale",
    vitals.morale.value,
    vitals.morale.max,
  );
}

/* What this seat's bars read right now, for the table to be told. */
export function vitalsReading() {
  return {
    health: { value: vitals.health.value, max: vitals.health.max },
    morale: { value: vitals.morale.value, max: vitals.morale.max },
  };
}

/* fill tops both bars up; otherwise a raised ceiling adds its own difference,
   so editing the sheet mid-session neither heals nor harms. A skill point
   spent on endurance or volition arrives through exactly this path — and
   raises no plate, because nothing was done to the character. */
export function refreshVitals(sheetState, fill) {
  let moved = false;
  Object.keys(vitals).forEach((kind) => {
    const state = vitals[kind];
    const next = vitalMax(sheetState, kind);
    const was = state.value;
    if (fill) state.value = next;
    /* A raised ceiling lifts a bar with it, so an emptied one stays empty
       while this seat is down or dead. */
    else if (next > state.max && !(floored() && state.value <= 0)) {
      state.value += next - state.max;
    }
    state.max = next;
    if (state.value > next) state.value = next;
    if (state.value < 0) state.value = 0;
    if (state.value !== was) moved = true;
  });
  renderVitals();
  if (moved && hooks.onMove) hooks.onMove();
}

/* Back on your feet: whichever bar was emptied is worth a single step again,
   so a revived character is not one node from the floor. */
export function reviveVitals() {
  let moved = false;
  Object.keys(vitals).forEach((kind) => {
    const state = vitals[kind];
    if (state.value > 0 || state.max <= 0) return;
    state.value = 1;
    moved = true;
  });
  if (moved) {
    renderVitals();
    if (hooks.onMove) hooks.onMove();
  }
}

/* The bar itself has already moved; this is only the movement being noticed.
   Queued behind whatever owns the screen, since a flash under the dice is a
   flash nobody sees. */
function flash(kind) {
  whenIdle(() => {
    const element = kind === "health" ? dom.healthBar : dom.moraleBar;
    if (!element) return;
    if (flashTimers[kind]) clearTimeout(flashTimers[kind]);
    element.classList.remove("is-hit");
    void element.offsetWidth;
    element.classList.add("is-hit");
    flashTimers[kind] = setTimeout(() => {
      element.classList.remove("is-hit");
      flashTimers[kind] = null;
    }, FLASH_CLEAR_MS);
  });
}

/* A signed number of steps of health or morale, clamped to the sheet's
   ceiling. Returns the actual change.

   A step that actually landed is both flashed on the bar and announced on the
   notice plate — the bar says how much is left, the plate says what just
   happened. A step that changed nothing says nothing. */
export function changeVital(kind, direction) {
  const state = vitals[kind];
  if (!state) return 0;
  const step = Math.round(Number(direction));
  const delta = isFinite(step)
    ? Math.max(-state.max, Math.min(state.max, step))
    : 0;
  if (!delta) return 0;
  /* Nothing brings a dead one back; a downed seat, though, is raised by what
     it reads. */
  if (delta > 0 && hooks.dead && hooks.dead()) return 0;

  const before = state.value;
  state.value = Math.max(0, Math.min(state.max, state.value + delta));
  renderVitals();
  if (state.value !== before) {
    flash(kind);
    overlays.vital(kind, state.value > before);
    /* Emptied: the app puts this seat on the floor and tells the table. */
    if (state.value === 0 && hooks.onEmpty) hooks.onEmpty(kind);
    /* A step back onto an empty bar, with the other above water too: the app
       takes this seat off the floor. */
    if (delta > 0 && before === 0 && standing() && hooks.onStand) {
      hooks.onStand();
    }
    /* The table is told what the bars read, so every seat can see them. */
    if (hooks.onMove) hooks.onMove();
  }
  return state.value - before;
}
