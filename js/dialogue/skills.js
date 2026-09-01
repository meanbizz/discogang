/* Skill lookup: a speaker name or skill id resolved against the sheet's
   ATTRIBUTES, with the attribute that owns it and its card art. */

const ART_BASE =
  "https://disco-elysium-skill-editor.netlify.app/_next/static/media";

let index = null;

/* "HAND / EYE COORDINATION" and "hand-eye-coordination" collapse to the same
   token, so a speaker name can be matched against a skill id. */
export function slug(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function build() {
  const map = {};
  const groups =
    (window.DiscoSkillSheet && window.DiscoSkillSheet.ATTRIBUTES) || [];
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    for (let j = 0; j < group.skills.length; j += 1) {
      const skill = group.skills[j];
      const record = {
        id: skill.id,
        name: skill.name,
        attribute: group.id,
        art: skill.art ? ART_BASE + "/" + skill.art : null,
      };
      map[slug(skill.id)] = record;
      map[slug(skill.name)] = record;
    }
  }
  return map;
}

/* The sheet script may not have run yet on the first call, so an empty index
   is retried rather than cached. */
export function findSkill(value) {
  if (!index || !Object.keys(index).length) index = build();
  const key = slug(value);
  return key && Object.prototype.hasOwnProperty.call(index, key)
    ? index[key]
    : null;
}

export function skillLabel(id) {
  const found = findSkill(id);
  if (found) return found.name;
  return String(id).replace(/[-_]+/g, " ").toUpperCase();
}
