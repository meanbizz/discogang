/* js/dialogue/dialogue.js */

/* The reader: walks one dialogue tree a node at a time inside the session
   log, spending vitals, earning experience and firing cues as it goes.

   Payload cleaning lives in sanitize.js, the line itself in entry.js, passive
   checks in passive.js, what was chosen in choices.js, past rounds in
   transcript.js, and choreography in cues.js. The pieces callers need are
   re-exported here, so the app has one door. */

import { dom } from "../dom.js";
import { own, pick } from "./text.js";
import { blocksNode } from "./passive.js";
import { findSkill } from "./skills.js";
import * as cues from "./cues.js";
import * as narration from "../audio/narration.js";
import { grantXp } from "../xp.js";
import { appendToLog, buildEntry, vitalsNote, voiceOf } from "./entry.js";

export { cleanPayload, parsePayload, pickTree } from "./sanitize.js";
export { hasTreeFor, renderRound } from "./transcript.js";
/* The app hands the reader's sheet over; passive checks are weighed on it. */
export { setSheet, PASSIVE_BONUS } from "./passive.js";
/* A choice made here is kept by the app, so it needs the same vocabulary. */
export {
  cleanChoice,
  keepChoice,
  choicesFor,
  describeChoice,
} from "./choices.js";

const MAX_STEPS = 400;

let tree = null;
let finished = true;
let steps = 0;
/* Nodes whose one-time effects have already landed: vitals spent, experience
   earned. A tree that loops back must not pay twice. */
const spentNodes = new Set();
let hooks = { onFinish: null, onSkillArt: null, onChoice: null, onXp: null };

export function setHooks(next) {
  hooks = {
    onFinish: (next && next.onFinish) || null,
    onSkillArt: (next && next.onSkillArt) || null,
    onChoice: (next && next.onChoice) || null,
    onXp: (next && next.onXp) || null,
  };
}

export function isFinished() {
  return finished;
}

/* The art a skill brings, and who spoke the line: the name is what tells a
   minted NPC from the narrator. */
function emitArt(url, speaker) {
  if (hooks.onSkillArt) hooks.onSkillArt(url || null, speaker || "");
}

/* The reader only says what was picked; remembering it is the app's business.
   index is the number the option was offered under, so a transcript can find
   it again even if the payload's ids were rewritten. */
function emitChoice(node, option, index) {
  if (!hooks.onChoice) return;
  hooks.onChoice({
    nodeId: node.id,
    optionId: option.id,
    label: option.label,
    index: index + 1,
  });
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
  spentNodes.clear();
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

/* Options read as a numbered list. The number is written here rather than by
   the stylesheet, so a live round, a transcript and a recorded choice all
   count alike. */
function renderOptions(host, node) {
  node.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = index + 1 + ". " + option.label;
    button.addEventListener("click", () => {
      if (host.dataset.spent === "true") return;
      host.dataset.spent = "true";
      /* Heard on the frame it was pressed — a dead click on a spent row makes
         no sound, which is why this sits under the guard. */
      cues.playChoice();
      const siblings = host.querySelectorAll("button");
      for (let i = 0; i < siblings.length; i += 1) siblings[i].disabled = true;
      button.classList.add("is-chosen");
      emitChoice(node, option, index);
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

  /* A skill speaking on the other side of the slab colours the slab. */
  const ahead = tree ? pick(tree.nodes, nextId) : null;
  const voice = ahead ? findSkill(ahead.speaker) : null;
  if (voice) {
    const tint = "var(--attr-" + voice.attribute + ")";
    button.style.background = tint;
    button.style.borderColor = tint;
  }

  /* The paper drifts a notch each time the reader presses on, tiled so the
     shift never opens a gap under the log. */
  const drift = () => {
    if (!dom.log) return;
    const next = (Number(dom.log.dataset.drift || 0) + 24) % 480;
    dom.log.dataset.drift = String(next);
    dom.log.style.backgroundRepeat = "repeat-y";
    dom.log.style.backgroundPositionY = "-" + next + "px";
  };

  button.appendChild(face);
  button.addEventListener("click", () => {
    if (host.dataset.spent === "true") return;
    host.dataset.spent = "true";
    cues.playChoice();
    drift();
    host.remove();
    renderNode(nextId);
  });
  host.appendChild(button);
}

/* Experience the node hands over. The overlay takes its turn on the one
   animation lane, so a rolled node's dice are always finished with the screen
   before the words arrive — nothing here has to know that happened. The
   ledger is moved here; the app is told after the fact, so it can publish and
   repaint the sheet.

   A point that landed on the last of the experience is still a point: the
   plate and its cue depend on either half of the reading, not on the XP
   alone. That was what could leave a new skill point silent. */
function earnXp(node) {
  if (!node.xpGained) return;
  const landed = grantXp(node.xpGained);
  if (!landed) return;
  if (!landed.gained && !landed.granted) return;
  cues.showXp(landed.gained || 0, landed.granted);
  if (hooks.onXp) hooks.onXp(landed);
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

  /* A passive this reader is not sharp enough for is never read: nothing is
     written, no vitals are spent, no experience is earned, and the scene
     carries on with whatever followed. Its options go with it — they were
     never offered. */
  if (blocksNode(node)) {
    if (node.next && own(tree.nodes, node.next)) {
      renderNode(node.next);
      return;
    }
    finish();
    return;
  }

  const voice = voiceOf(node);
  const rolled = Boolean(
    node.skillCheck && node.skillCheck.result && !node.skillCheck.passive,
  );

  /* A rolled node hides its own arrival and claims its place in the queue on
     this frame, before anything else the node sets off can ask for one: the
     incoming entry is already invisible when it lands, and the vitals flash,
     the health plate and the experience plate below fall in behind the dice.
     A passive is never rolled, so it hides nothing and waits for nothing. */
  if (rolled) cues.beginRoll(node.skillCheck);

  const article = buildEntry(node, voice, "node:" + node.id);
  article.classList.add("current");

  const first = !spentNodes.has(id);
  spentNodes.add(id);

  const note = vitalsNote(node.vitals, first, node.xpGained);
  if (note) article.appendChild(note);

  appendToLog(article);
  emitArt(voice ? voice.art : null, node.speaker);
  cues.playNode(voice, node.skillCheck);
  if (first) earnXp(node);

  const choices = document.createElement("div");
  choices.className = "entry-choices";
  article.appendChild(choices);

  if (node.options.length) {
    renderOptions(choices, node);
  } else if (node.next && own(tree.nodes, node.next)) {
    renderContinue(choices, node.next);
  } else {
    choices.remove();
    finish();
  }

  dom.log.scrollTop = dom.log.scrollHeight;
}
