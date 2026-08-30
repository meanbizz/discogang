import { dom } from "./dom.js";
import { VITAL_SKILL } from "./config.js";

export const vitals = {
  health: { value: 0, max: 0 },
  morale: { value: 0, max: 0 },
};

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

export function renderBar(element, label, filled, total) {
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
