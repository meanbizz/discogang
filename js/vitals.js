/* Health and morale: the two bars, their ceilings taken from the skill sheet,
   and the single-step changes a dialogue node spends. The is-hit flash is
   animated in animations.css. */

import { dom } from "./dom.js";
import { VITAL_SKILL } from "./config.js";
import { TIMING } from "./timing.js";

export const vitals = {
  health: { value: 0, max: 0 },
  morale: { value: 0, max: 0 },
};

const FLASH_CLEAR_MS = TIMING.vitals.flashMs + TIMING.vitals.clearBufferMs;
const flashTimers = {};

export function skillScore(sheetState, skillId) {
  if (!sheetState || !sheetState.attributes || !sheetState.skills) return 1;
  const groups = window.DiscoSkillSheet?.ATTRIBUTES || [];
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = 0; j < groups[i].skills.length; j += 1) {
      if (groups[i].skills[j].id !== skillId) continue;
      const owner = Number(sheetState.attributes[groups[i].id]) || 1;
      const skill = sheetState.skills[skillId] || {};
      return owner + (Number(skill.points) || 0) + (skill.signature ? 1 : 0);
    }
  }
  return 1;
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
   so editing the sheet mid-session neither heals nor harms. */
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

function flash(kind) {
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
