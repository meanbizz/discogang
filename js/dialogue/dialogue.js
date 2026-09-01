/* The reader: walks one dialogue tree a node at a time inside the session
   log, spending vitals and firing cues as it goes.

   Payload cleaning lives in sanitize.js, the line itself in entry.js, past
   rounds in transcript.js, and choreography in cues.js. The pieces callers
   need are re-exported here, so the app has one door. */

import { dom } from "../dom.js";
import { own, pick } from "./text.js";
import * as cues from "./cues.js";
import * as narration from "../audio/narration.js";
import { appendToLog, buildEntry, vitalsNote, voiceOf } from "./entry.js";

export { cleanPayload, parsePayload, pickTree } from "./sanitize.js";
export { hasTreeFor, renderRound } from "./transcript.js";

const MAX_STEPS = 400;

let tree = null;
let finished = true;
let steps = 0;
const vitalsSpent = new Set();
let hooks = { onFinish: null, onSkillArt: null };

export function setHooks(next) {
  hooks = {
    onFinish: (next && next.onFinish) || null,
    onSkillArt: (next && next.onSkillArt) || null,
  };
}

export function isFinished() {
  return finished;
}

function emitArt(url) {
  if (hooks.onSkillArt) hooks.onSkillArt(url || null);
}

function finish() {
  if (finished) return;
  finished = true;
  if (hooks.onFinish) hooks.onFinish();
}

export function reset() {
  tree = null;
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
  finished = false;
  renderNode(tree.root);
  return true;
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
      /* Nothing follows — let the row fade before the scene closes. */
      cues.fadeOutAndRemove(host, () => finish());
    });
    host.appendChild(button);
  });
}

function renderContinue(host, nextId) {
  const face = document.createElement("span");
  face.style.display = "inline-block";
  face.style.transform = "scale(1, 1.5)";
  face.style.letterSpacing = "0px";
  face.style.transformOrigin = "0 0";
  face.style.lineHeight = "1";
  face.textContent = "Continue ➤";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice continue";
  button.appendChild(face);
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

  const voice = voiceOf(node);

  /* A rolled node hides its own arrival: the tape starts on this frame, so
     the incoming entry is already invisible when it lands. */
  if (node.skillCheck && node.skillCheck.result) cues.beginRoll();

  const article = buildEntry(node, voice, "node:" + node.id);
  article.classList.add("current");

  const note = vitalsNote(node.vitals, !vitalsSpent.has(id));
  vitalsSpent.add(id);
  if (note) article.appendChild(note);

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
