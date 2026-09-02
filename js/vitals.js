/* Health and morale: the two bars, their ceilings taken from the skill sheet,
   and the single-step changes a dialogue node spends. The is-hit flash is
   animated in animations.css.

   The arithmetic itself lives in js/sheet.js, so the save writer and the sheet
   header read the same numbers this does.

   The flash is the one thing here that waits on anything: it goes through the
   animation lane, so a bar moving under a node that also rolls is seen after
   the dice rather than behind them. */

import { dom } from "./dom.js";
import { VITAL_SKILL } from "./config.js";
import { TIMING } from "./timing.js";
import { skillScores } from "./sheet.js";
import { whenIdle } from "./sequencer.js";

export const vitals = {
  health: { value: 0, max: 0 },
  morale: { value: 0, max: 0 },
};

const FLASH_CLEAR_MS = TIMING.vitals.flashMs + TIMING.vitals.clearBufferMs;
const flashTimers = {};

/* One skill's score, or 1 when there is no sheet to read it off. */
export function skillScore(sheetState, skillId) {
  const scores = skillScores(sheetState);
  return Object.prototype.hasOwnProperty.call(scores, skillId)
    ? scores[skillId]
    : 1;
}

export function vitalMax(sheetState, kind) {
  return skillScore(sheetState, VITAL_SKILL[kind]) + 1;
}

function renderBar(element, label, filled, total) {
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
  renderBar(dom.healthBar, "Health", vitals.health.value, vitals.health.max);
  renderBar(dom.moraleBar, "Morale", vitals.morale.value, vitals.morale.max);
}

/* fill tops both bars up; otherwise a raised ceiling adds its own difference,
   so editing the sheet mid-session neither heals nor harms. A skill point
   spent on endurance or volition arrives through exactly this path. */
export function refreshVitals(sheetState, fill) {
  Object.keys(vitals).forEach((kind) => {
    const state = vitals[kind];
    const next = vitalMax(sheetState, kind);
    if (fill) state.value = next;
    else if (next > state.max) state.value += next - state.max;
    state.max = next;
    if (state.value > next) state.value = next;
    if (state.value < 0) state.value = 0;
  });
  renderVitals();
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

/* One step of health or morale, clamped to the sheet's ceiling. direction is
   "gain" or "loss"; returns the actual change. */
export function changeVital(kind, direction) {
  const state = vitals[kind];
  if (!state) return 0;
  const delta = direction === "gain" ? 1 : direction === "loss" ? -1 : 0;
  if (!delta) return 0;

  const before = state.value;
  state.value = Math.max(0, Math.min(state.max, state.value + delta));
  renderVitals();
  if (state.value !== before) flash(kind);
  return state.value - before;
}
