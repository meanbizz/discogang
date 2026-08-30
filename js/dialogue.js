/* Dialogue rounds.

   Ingests the administrateur's TurnResolutionPayload, hands each player the
   tree that belongs to them, and walks it one node at a time inside the
   session log. Everything crossing the wire is rebuilt field by field, so a
   peer can only ever contribute the shapes this reader already understands. */

import { dom } from "./dom.js";
import { paintMarkup } from "./utils.js";
import * as vitals from "./vitals.js";

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

let tree = null;
let cursor = null;
let active = false;
let finished = true;
let steps = 0;
const vitalsSpent = new Set();
let hooks = { onFinish: null };

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

function skillLabel(id) {
  const groups =
    (window.DiscoSkillSheet && window.DiscoSkillSheet.ATTRIBUTES) || [];
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = 0; j < groups[i].skills.length; j += 1) {
      if (groups[i].skills[j].id === id) return groups[i].skills[j].name;
    }
  }
  return String(id).replace(/[-_]+/g, " ").toUpperCase();
}

/* ---------------- Sanitising ---------------- */

function cleanCheck(raw) {
  if (!raw || typeof raw !== "object") return null;
  const skill = line(raw.skill, 64);
  if (!skill) return null;

  const difficulty = normalizeKey(raw.difficulty);
  const result = normalizeKey(raw.result);
  const dice =
    raw.diceRoll && typeof raw.diceRoll === "object" ? raw.diceRoll : {};

  const die = (value) => {
    const number = Math.round(Number(value));
    return isFinite(number) && number >= 1 && number <= 6 ? number : 0;
  };
  const modifier = Math.round(Number(raw.modifier));

  return {
    skill,
    difficulty: own(DIFFICULTY_TARGET, difficulty) ? difficulty : "",
    result: own(RESULTS, result) ? result : "",
    dice1: die(dice.dice1),
    dice2: die(dice.dice2),
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
  hooks = { onFinish: (next && next.onFinish) || null };
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

function finish(note) {
  if (finished) return;
  finished = true;

  const end = document.createElement("p");
  end.className = "dialogue-end";
  end.textContent = note || "— end of scene —";
  dom.log.appendChild(end);
  dom.log.scrollTop = dom.log.scrollHeight;

  if (hooks.onFinish) hooks.onFinish();
}

function renderCheck(check) {
  const banner = document.createElement("div");
  banner.className = "check";
  if (check.result) banner.dataset.result = check.result;

  const skill = document.createElement("span");
  skill.className = "check-skill";
  skill.textContent = skillLabel(check.skill);
  banner.appendChild(skill);

  if (check.difficulty) {
    const target = document.createElement("span");
    target.className = "check-target";
    target.textContent =
      check.difficulty.charAt(0).toUpperCase() +
      check.difficulty.slice(1) +
      " " +
      DIFFICULTY_TARGET[check.difficulty] +
      "+";
    banner.appendChild(target);
  }

  if (check.dice1 && check.dice2) {
    const total = check.dice1 + check.dice2 + check.modifier;
    const dice = document.createElement("span");
    dice.className = "check-dice";
    dice.textContent =
      check.dice1 +
      " + " +
      check.dice2 +
      (check.modifier
        ? (check.modifier > 0 ? " + " : " − ") + Math.abs(check.modifier)
        : "") +
      " = " +
      total;
    banner.appendChild(dice);

    if (
      check.dice1 === check.dice2 &&
      (check.dice1 === 1 || check.dice1 === 6)
    ) {
      banner.dataset.crit = "true";
    }
  }

  if (check.result) {
    const verdict = document.createElement("span");
    verdict.className = "check-verdict";
    verdict.textContent =
      (banner.dataset.crit === "true" ? "critical " : "") + check.result;
    banner.appendChild(verdict);
  }

  return banner;
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
      if (option.next) renderNode(option.next);
      else finish();
    });
    host.appendChild(button);
  });
}

function renderContinue(host, nextId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice continue";
  button.textContent = "[ Continue ]";
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
    finish("— the scene runs in circles. Stopping here. —");
    return;
  }
  cursor = id;

  const article = document.createElement("article");
  article.className = "entry dialogue current";
  article.dataset.node = id;

  if (node.skillCheck) article.appendChild(renderCheck(node.skillCheck));

  if (node.speaker) {
    const speaker = document.createElement("p");
    speaker.className = "entry-speaker";
    speaker.textContent = node.speaker;
    article.appendChild(speaker);
  }

  const body = document.createElement("p");
  body.className = "entry-body";
  paintMarkup(body, node.dialogue);
  article.appendChild(body);

  if (node.vitals) {
    const note = renderVitals(node.vitals, id);
    if (note) article.appendChild(note);
  }

  appendToLog(article);

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
