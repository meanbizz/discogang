/* js/sheet.js */

/* Reading numbers off the skill sheet, and the shapes those numbers travel
   in.

   Pure on purpose: no DOM, no network, and no imports at all. The sheet
   script is consulted through window.DiscoSkillSheet when it happens to be
   there, and everything degrades to empty when it is not — which is what lets
   both the save writer and the app share this file. */

const SCORE_MAX = 40;
const POINTS_MAX = 20;
const ID_MAX = 64;
const MAX_SKILLS = 64;

function own(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

export function skillGroups() {
  const groups = window.DiscoSkillSheet && window.DiscoSkillSheet.ATTRIBUTES;
  return Array.isArray(groups) ? groups : [];
}

/* Every skill the build knows, in the order the sheet lays them out. */
export function orderedSkillIds() {
  const out = [];
  skillGroups().forEach((group) => {
    (group.skills || []).forEach((skill) => {
      if (skill && skill.id) out.push(skill.id);
    });
  });
  return out;
}

function titleCase(name) {
  return String(name == null ? "" : name)
    .toLowerCase()
    .replace(/(^|[\s/])([a-z])/g, (match, lead, letter) => {
      return lead + letter.toUpperCase();
    });
}

/* "Hand / Eye Coordination" rather than the sheet's shouting caps: the
   administrateur reads these in a clipboard listing, not on a card. */
export function skillTitle(id) {
  const groups = skillGroups();
  for (let i = 0; i < groups.length; i += 1) {
    const skills = groups[i].skills || [];
    for (let j = 0; j < skills.length; j += 1) {
      if (skills[j].id === id) return titleCase(skills[j].name);
    }
  }
  return titleCase(String(id).replace(/[-_]+/g, " "));
}

function pointsOf(sheetState, id) {
  const skill = sheetState && sheetState.skills ? sheetState.skills[id] : null;
  if (!skill) return 0;
  const points = Math.round(Number(skill.points));
  return isFinite(points) && points > 0 ? Math.min(POINTS_MAX, points) : 0;
}

/* attribute + allocated points + the signature bonus — the number a check is
   actually written against. */
export function skillScores(sheetState) {
  const out = {};
  if (!sheetState || !sheetState.attributes || !sheetState.skills) return out;

  skillGroups().forEach((group) => {
    const owner = Number(sheetState.attributes[group.id]) || 1;
    (group.skills || []).forEach((skill) => {
      if (!skill || !skill.id) return;
      const held = sheetState.skills[skill.id] || {};
      const score =
        owner + pointsOf(sheetState, skill.id) + (held.signature ? 1 : 0);
      out[skill.id] = Math.max(0, Math.min(SCORE_MAX, score));
    });
  });
  return out;
}

/* Only the points a player has spent, so a restore can hand them back without
   touching the attributes they arrived with. */
export function allocatedPoints(sheetState) {
  const out = {};
  if (!sheetState || !sheetState.skills) return out;
  orderedSkillIds().forEach((id) => {
    const points = pointsOf(sheetState, id);
    if (points) out[id] = points;
  });
  return out;
}

/* A copy of the sheet with the saved points written back in. The sheet's own
   normalize is what caps them against the attributes afterwards. */
export function adoptAllocated(sheetState, allocated) {
  const source = sheetState && typeof sheetState === "object" ? sheetState : {};
  const next = {
    attributes: Object.assign({}, source.attributes),
    skills: {},
    selected: source.selected || null,
  };

  const held =
    source.skills && typeof source.skills === "object" ? source.skills : {};
  Object.keys(held).forEach((id) => {
    next.skills[id] = Object.assign({}, held[id]);
  });

  const wanted = cleanAllocated(allocated);
  Object.keys(wanted).forEach((id) => {
    if (!next.skills[id]) next.skills[id] = { points: 0, signature: false };
    next.skills[id].points = wanted[id];
  });
  return next;
}

function cleanMap(raw, ceiling) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  const keys = Object.keys(raw);
  let kept = 0;
  for (let i = 0; i < keys.length && kept < MAX_SKILLS; i += 1) {
    const id = String(keys[i]).slice(0, ID_MAX);
    if (!id || !/^[a-z0-9-]+$/i.test(id) || own(out, id)) continue;
    const value = Math.round(Number(raw[keys[i]]));
    if (!isFinite(value) || value < 0) continue;
    out[id] = Math.min(ceiling, value);
    kept += 1;
  }
  return out;
}

export function cleanScores(raw) {
  return cleanMap(raw, SCORE_MAX);
}

export function cleanAllocated(raw) {
  return cleanMap(raw, POINTS_MAX);
}

/* "Logic:2,Rhetoric:2,Encyclopedia:3" — sheet order, whatever order the map
   happened to be built in. */
export function describeSkills(scores) {
  const held = scores && typeof scores === "object" ? scores : {};
  const parts = [];
  orderedSkillIds().forEach((id) => {
    if (own(held, id)) parts.push(skillTitle(id) + ":" + held[id]);
  });
  return parts.join(",");
}
