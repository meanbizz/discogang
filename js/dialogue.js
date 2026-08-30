/* Dialogue rounds.

   Ingests the administrateur's TurnResolutionPayload, hands each player the
   tree that belongs to them, and walks it one node at a time inside the
   session log. Everything crossing the wire is rebuilt field by field, so a
   peer can only ever contribute the shapes this reader already understands.

   This file says what happened; cues.js says how long it takes and what it
   sounds like. No duration and no animation class belongs here. */

import { dom } from "./dom.js";
import { paintMarkup } from "./utils.js";
import * as vitals from "./vitals.js";
import * as cues from "./cues.js";
import * as narration from "./narration.js";

export const DIFFICULTY_TARGET = {
  trivial: 6,
  easy: 8,
  medium: 10,
  challenging: 12,
  formidable: 13,
  legendary: 14,
  heroic: 15,
  godly: 16,
  impossible: 18,
};

const VITAL_OF = { vitality: "health", morale: "morale" };
const RESULTS = { success: true, failure: true };

const MAX_PAYLOAD_CHARS = 200000;
const MAX_TREES = 16;
const MAX_NODES = 240;
const MAX_OPTIONS = 8;
const MAX_STEPS = 400;
const KEY_MAX = 120;
const SPEAKER_MAX = 48;
const LABEL_MAX = 240;
const BODY_MAX = 4000;

/* Card art lives with the skill sheet's assets; the sheet exposes the file
   names on DiscoSkillSheet.ATTRIBUTES, so only the base needs repeating. */
const SKILL_ART_BASE =
  "https://disco-elysium-skill-editor.netlify.app/_next/static/media";

let tree = null;
let cursor = null;
let active = false;
let finished = true;
let steps = 0;
const vitalsSpent = new Set();
let hooks = { onFinish: null, onSkillArt: null };

/* ---------------- Small helpers ---------------- */

function own(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

function pick(map, key) {
  return own(map, key) ? map[key] : null;
}

function line(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(value) {
  return value.replace(/&(#\d{1,7}|[a-z]{2,8});/gi, (match, name) => {
    if (name.charAt(0) === "#") {
      const code = Number(name.slice(1));
      if (code > 0 && code < 0x110000) {
        try {
          return String.fromCodePoint(code);
        } catch (error) {
          return match;
        }
      }
      return match;
    }
    const key = name.toLowerCase();
    return own(ENTITIES, key) ? ENTITIES[key] : match;
  });
}

/* Bodies arrive as "HTML/text". Tags are flattened to newlines and dropped;
   the result is only ever written with textContent. */
function bodyText(value) {
  if (typeof value !== "string") return "";
  const flattened = value
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(flattened)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BODY_MAX);
}

function normalizeKey(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* "HAND / EYE COORDINATION" and "hand-eye-coordination" collapse to the
   same token, so a speaker name can be matched against a skill id. */
function slug(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

let skillIndex = null;

function buildSkillIndex() {
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
        art: skill.art ? SKILL_ART_BASE + "/" + skill.art : null,
      };
      map[slug(skill.id)] = record;
      map[slug(skill.name)] = record;
    }
  }
  return map;
}

/* The sheet script may not have run yet on the first call, so an empty index
   is retried rather than cached. */
function findSkill(value) {
  if (!skillIndex || !Object.keys(skillIndex).length) {
    skillIndex = buildSkillIndex();
  }
  const key = slug(value);
  return key && own(skillIndex, key) ? skillIndex[key] : null;
}

function skillLabel(id) {
  const found = findSkill(id);
  if (found) return found.name;
  return String(id).replace(/[-_]+/g, " ").toUpperCase();
}

function emitArt(url) {
  if (hooks.onSkillArt) hooks.onSkillArt(url || null);
}

/* ---------------- Sanitising ---------------- */

/* "SUCCESS", "passed", "Critical failure" — anything that plainly reads as a
   verdict resolves to one of the two the overlay knows. */
function resolveResult(value) {
  const key = normalizeKey(value);
  if (!key) return "";
  if (own(RESULTS, key)) return key;
  if (/succ|pass|win/.test(key)) return "success";
  if (/fail|miss|lose|lost/.test(key)) return "failure";
  return "";
}

function dieValue(value) {
  const number = Math.round(Number(value));
  return isFinite(number) && number >= 1 && number <= 6 ? number : 0;
}

/* A pair of dice may arrive as diceRoll/dice/roll, as an object keyed
   dice1/die1/d1 or as a two-slot array, or loose on the check itself. When
   none of those hold up the pair stays at zero and the verdict simply shows
   without faces. */
function cleanDice(raw) {
  const sources = [raw.diceRoll, raw.dice, raw.roll, raw];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (!source || typeof source !== "object") continue;

    if (Array.isArray(source)) {
      const first = dieValue(source[0]);
      const second = dieValue(source[1]);
      if (first && second) return { dice1: first, dice2: second };
      continue;
    }

    const first = dieValue(
      source.dice1 != null
        ? source.dice1
        : source.die1 != null
          ? source.die1
          : source.d1 != null
            ? source.d1
            : source.first,
    );
    const second = dieValue(
      source.dice2 != null
        ? source.dice2
        : source.die2 != null
          ? source.die2
          : source.d2 != null
            ? source.d2
            : source.second,
    );
    if (first && second) return { dice1: first, dice2: second };
  }
  return { dice1: 0, dice2: 0 };
}

function cleanCheck(raw) {
  if (!raw || typeof raw !== "object") return null;

  const skill = line(raw.skill, 64);
  const result = resolveResult(raw.result);
  /* A verdict with no named skill is still a verdict worth showing. */
  if (!skill && !result) return null;

  const difficulty = normalizeKey(raw.difficulty);
  const dice = cleanDice(raw);
  const modifier = Math.round(Number(raw.modifier));

  return {
    skill,
    difficulty: own(DIFFICULTY_TARGET, difficulty) ? difficulty : "",
    result,
    dice1: dice.dice1,
    dice2: dice.dice2,
    modifier: isFinite(modifier) ? Math.max(-20, Math.min(20, modifier)) : 0,
  };
}

function cleanVitals(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  Object.keys(VITAL_OF).forEach((field) => {
    const direction = normalizeKey(raw[field]);
    if (direction === "gain" || direction === "loss") out[field] = direction;
  });
  return Object.keys(out).length ? out : null;
}

function cleanOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_OPTIONS; i += 1) {
    const option = raw[i];
    if (!option || typeof option !== "object") continue;
    const label = line(option.label, LABEL_MAX);
    if (!label) continue;
    out.push({
      id: line(option.id, KEY_MAX) || "opt-" + out.length,
      label,
      next: typeof option.next === "string" ? line(option.next, KEY_MAX) : null,
    });
  }
  return out;
}

function cleanNode(raw, id) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const dialogue = bodyText(raw.dialogue);
  const options = cleanOptions(raw.options);
  const check = cleanCheck(raw.skillCheck);
  if (!dialogue && !options.length && !check) return null;

  return {
    id,
    speaker: line(raw.speaker, SPEAKER_MAX),
    dialogue,
    next: typeof raw.next === "string" ? line(raw.next, KEY_MAX) : null,
    vitals: cleanVitals(raw.vitals),
    skillCheck: check,
    options,
  };
}

function cleanTree(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw.nodes;
  if (!source || typeof source !== "object" || Array.isArray(source))
    return null;

  const nodes = {};
  const ids = Object.keys(source);
  let kept = 0;
  for (let i = 0; i < ids.length && kept < MAX_NODES; i += 1) {
    const id = line(ids[i], KEY_MAX);
    if (!id || own(nodes, id)) continue;
    const node = cleanNode(source[ids[i]], id);
    if (!node) continue;
    nodes[id] = node;
    kept += 1;
  }

  const kepts = Object.keys(nodes);
  if (!kepts.length) return null;

  let root = line(raw.root, KEY_MAX);
  if (!root || !own(nodes, root)) root = kepts[0];
  return { root, nodes };
}

export function cleanPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  const keys = Object.keys(raw);
  let kept = 0;
  for (let i = 0; i < keys.length && kept < MAX_TREES; i += 1) {
    const key = line(keys[i], KEY_MAX);
    if (!key || own(out, key)) continue;
    const cleaned = cleanTree(raw[keys[i]]);
    if (!cleaned) continue;
    out[key] = cleaned;
    kept += 1;
  }
  return kept ? out : null;
}

function stripFence(text) {
  const trimmed = String(text == null ? "" : text).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/* Returns { payload, error, raw }. A null payload with a null error means the
   text was never meant to be a payload — speak it as prose instead. */
export function parsePayload(text) {
  const raw = stripFence(text);
  if (!raw || raw.charAt(0) !== "{") return { payload: null, error: null, raw };
  if (raw.length > MAX_PAYLOAD_CHARS) {
    return { payload: null, error: "That payload is too large to send.", raw };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      payload: null,
      error: "That looked like a turn payload, but the JSON is malformed.",
      raw,
    };
  }

  const payload = cleanPayload(parsed);
  if (!payload) {
    return {
      payload: null,
      error: "No usable dialogue trees in that payload.",
      raw,
    };
  }
  return { payload, error: null, raw };
}

/* Keys are character names or PeerJS ids — try the id first. */
export function pickTree(payload, selfId, name) {
  if (!payload) return null;
  if (own(payload, selfId)) return payload[selfId];

  const wanted = normalizeKey(name);
  if (!wanted) return null;
  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i += 1) {
    if (normalizeKey(keys[i]) === wanted) return payload[keys[i]];
  }
  return null;
}

export function treeKeys(payload) {
  return payload ? Object.keys(payload) : [];
}

/* ---------------- Reader ---------------- */

export function setHooks(next) {
  hooks = {
    onFinish: (next && next.onFinish) || null,
    onSkillArt: (next && next.onSkillArt) || null,
  };
}

export function isActive() {
  return active;
}

export function isFinished() {
  return finished;
}

export function currentNode() {
  return cursor;
}

export function reset() {
  tree = null;
  cursor = null;
  active = false;
  finished = true;
  steps = 0;
  vitalsSpent.clear();
  cues.reset();
  narration.stop();
  emitArt(null);
}

export function start(nextTree) {
  reset();
  if (!nextTree || !nextTree.nodes) return false;
  tree = nextTree;
  active = true;
  finished = false;
  renderNode(tree.root);
  return true;
}

function appendToLog(node) {
  const placeholder = dom.log.querySelector(".log-empty");
  if (placeholder) placeholder.remove();
  const previous = dom.log.querySelector(".entry.current");
  if (previous) previous.classList.remove("current");
  dom.log.appendChild(node);
  dom.log.scrollTop = dom.log.scrollHeight;
}

function finish() {
  if (finished) return;
  finished = true;
  if (hooks.onFinish) hooks.onFinish();
}

/* [Medium 10+: success] — sits inside the speaker line. The dice breakdown
   rides along as a title so the numbers stay reachable. */
function checkTag(check) {
  const parts = [];

  if (check.difficulty) {
    parts.push(
      check.difficulty.charAt(0).toUpperCase() + check.difficulty.slice(1),
    );
  }

  if (check.result) parts.push(check.result);
  if (!parts.length) parts.push(skillLabel(check.skill));

  const tag = document.createElement("span");
  tag.className = "check-tag";
  if (check.result) tag.dataset.result = check.result;
  tag.textContent = "[" + parts.join(": ") + "]";

  if (check.dice1 && check.dice2) {
    if (
      check.dice1 === check.dice2 &&
      (check.dice1 === 1 || check.dice1 === 6)
    ) {
      tag.dataset.crit = "true";
    }
    const total = check.dice1 + check.dice2 + check.modifier;
    tag.title =
      skillLabel(check.skill) +
      " — " +
      check.dice1 +
      " + " +
      check.dice2 +
      (check.modifier
        ? (check.modifier > 0 ? " + " : " − ") + Math.abs(check.modifier)
        : "") +
      " = " +
      total;
  } else {
    tag.title = skillLabel(check.skill);
  }

  return tag;
}

/* The narrator's own lines can be read aloud. The button rides at the end of
   the line, out of sight until the entry is hovered, and it is the only
   control: a second press cancels the fetch or stops the clip. */
const SPEAK_FACE = {
  idle: "▶",
  loading: "…",
  playing: "■",
  error: "!",
};

const SPEAK_TITLE = {
  idle: "Read this aloud",
  loading: "Fetching the reading — press again to cancel",
  playing: "Stop reading",
  error: "That line could not be read aloud — press to try again",
};

function paintSpeakButton(button, state) {
  const key = own(SPEAK_FACE, state) ? state : "idle";
  button.dataset.state = key;
  button.textContent = SPEAK_FACE[key];
  button.title = SPEAK_TITLE[key];
  button.setAttribute("aria-label", SPEAK_TITLE[key]);
  button.setAttribute("aria-pressed", key === "playing" ? "true" : "false");
}

function speakButton(node) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entry-speak";
  paintSpeakButton(button, "idle");

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    narration.toggle("node:" + node.id, node.dialogue, (state) => {
      paintSpeakButton(button, state);
    });
  });

  return button;
}

function renderVitals(effect, nodeId) {
  const spent = vitalsSpent.has(nodeId);
  const note = document.createElement("p");
  note.className = "vitals-note";
  let any = false;

  Object.keys(VITAL_OF).forEach((field) => {
    const direction = effect[field];
    if (!direction) return;
    const kind = VITAL_OF[field];
    if (!spent) vitals.changeVital(kind, direction);

    const item = document.createElement("span");
    item.className = "vitals-note-item";
    item.dataset.vital = kind;
    item.textContent =
      (kind === "health" ? "Health" : "Morale") +
      (direction === "gain" ? " +1" : " −1");
    note.appendChild(item);
    any = true;
  });

  vitalsSpent.add(nodeId);
  return any ? note : null;
}

function renderOptions(host, options) {
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      if (host.dataset.spent === "true") return;
      host.dataset.spent = "true";
      const siblings = host.querySelectorAll("button");
      for (let i = 0; i < siblings.length; i += 1) siblings[i].disabled = true;
      button.classList.add("is-chosen");
      if (option.next) {
        renderNode(option.next);
        return;
      }
      /* Nothing follows this choice — let it fade before the scene closes. */
      cues.fadeOutAndRemove(host, () => finish());
    });
    host.appendChild(button);
  });
}

function renderContinue(host, nextId) {
  const buttonContent = document.createElement("span");
  buttonContent.style.display = "inline-block";
  buttonContent.style.transform = "scale(1, 1.5)";
  buttonContent.style.letterSpacing = "0px";
  buttonContent.style.transformOrigin = "0 0";
  buttonContent.style.lineHeight = "1";
  buttonContent.textContent = "Continue ➤";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice continue";
  button.appendChild(buttonContent);
  button.addEventListener("click", () => {
    if (host.dataset.spent === "true") return;
    host.dataset.spent = "true";
    host.remove();
    renderNode(nextId);
  });
  host.appendChild(button);
}

function renderNode(id) {
  const node = tree ? pick(tree.nodes, id) : null;
  if (!node) {
    finish();
    return;
  }

  steps += 1;
  if (steps > MAX_STEPS) {
    finish();
    return;
  }
  cursor = id;

  /* A speaker that names a skill drives both its colour and the scene
     thumbnail; a bare check falls back to the skill being rolled. */
  const voice =
    findSkill(node.speaker) ||
    (node.skillCheck ? findSkill(node.skillCheck.skill) : null);

  /* A rolled node hides its own arrival: cues.beginRoll runs the tape on this
     frame, so the incoming entry is already invisible when it lands. */
  if (node.skillCheck && node.skillCheck.result) cues.beginRoll();

  const article = document.createElement("article");
  article.className = "entry dialogue current";
  article.dataset.node = id;
  if (node.skillCheck && node.skillCheck.result) {
    article.dataset.result = node.skillCheck.result;
  }

  /* Speaker, check verdict, and body all live on one line. */
  const lead = document.createElement("p");
  lead.className = "entry-line";

  if (node.speaker) {
    const speaker = document.createElement("span");
    speaker.className = "entry-speaker";
    if (voice) speaker.dataset.attribute = voice.attribute;
    speaker.textContent = node.speaker;
    lead.appendChild(speaker);
  }

  if (node.skillCheck) {
    if (lead.childNodes.length) {
      lead.appendChild(document.createTextNode(" "));
    }
    lead.appendChild(checkTag(node.skillCheck));
  }

  if (lead.childNodes.length && node.dialogue) {
    lead.appendChild(document.createTextNode(" — "));
  }

  const body = document.createElement("span");
  body.className = "entry-body";
  paintMarkup(body, node.dialogue);
  lead.appendChild(body);

  /* Only the narrator's lines are offered aloud. */
  if (node.dialogue && narration.isNarrator(node.speaker)) {
    article.dataset.narrated = "true";
    lead.appendChild(document.createTextNode(" "));
    lead.appendChild(speakButton(node));
  }

  article.appendChild(lead);

  if (node.vitals) {
    const note = renderVitals(node.vitals, id);
    if (note) article.appendChild(note);
  }

  appendToLog(article);
  emitArt(voice ? voice.art : null);
  cues.playNode(voice, node.skillCheck);

  const choices = document.createElement("div");
  choices.className = "entry-choices";
  article.appendChild(choices);

  if (node.options.length) {
    renderOptions(choices, node.options);
  } else if (node.next && own(tree.nodes, node.next)) {
    renderContinue(choices, node.next);
  } else {
    choices.remove();
    finish();
  }

  dom.log.scrollTop = dom.log.scrollHeight;
}
