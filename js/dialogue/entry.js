/* One dialogue line as a DOM node: speaker, verdict tag, body, vitals note
   and the narrator's read-aloud button. A live node and a restored one are
   the same article; only what is appended after differs. */

import { dom } from "../dom.js";
import { paintMarkup } from "../utils.js";
import * as vitals from "../vitals.js";
import * as narration from "../audio/narration.js";
import { findSkill, skillLabel } from "./skills.js";

const VITAL_OF = { vitality: "health", morale: "morale" };

export function appendToLog(node) {
  const placeholder = dom.log.querySelector(".log-empty");
  if (placeholder) placeholder.remove();
  const previous = dom.log.querySelector(".entry.current");
  if (previous) previous.classList.remove("current");
  dom.log.appendChild(node);
  dom.log.scrollTop = dom.log.scrollHeight;
}

/* [Medium 10+: success], with the dice breakdown as a title. */
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

const SPEAK_FACE = { idle: "▶", loading: "…", playing: "■", error: "!" };

const SPEAK_TITLE = {
  idle: "Read this aloud",
  loading: "Fetching the reading — press again to cancel",
  playing: "Stop reading",
  error: "That line could not be read aloud — press to try again",
};

function paintSpeakButton(button, state) {
  const key = Object.prototype.hasOwnProperty.call(SPEAK_FACE, state)
    ? state
    : "idle";
  button.dataset.state = key;
  button.textContent = SPEAK_FACE[key];
  button.title = SPEAK_TITLE[key];
  button.setAttribute("aria-label", SPEAK_TITLE[key]);
  button.setAttribute("aria-pressed", key === "playing" ? "true" : "false");
}

/* speakKey names the clip for narration.js. A live node and the same node in
   a restored round carry different keys, so one cannot stop the other. */
function speakButton(speakKey, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entry-speak";
  paintSpeakButton(button, "idle");

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    narration.toggle(speakKey, text, (state) => {
      paintSpeakButton(button, state);
    });
  });

  return button;
}

/* apply is what separates a scene being played from one being read back: a
   transcript shows the same note without spending anybody's vitals. */
export function vitalsNote(effect, apply) {
  if (!effect) return null;

  const note = document.createElement("p");
  note.className = "vitals-note";
  let any = false;

  Object.keys(VITAL_OF).forEach((field) => {
    const direction = effect[field];
    if (!direction) return;
    const kind = VITAL_OF[field];
    if (apply) vitals.changeVital(kind, direction);

    const item = document.createElement("span");
    item.className = "vitals-note-item";
    item.dataset.vital = kind;
    item.textContent =
      (kind === "health" ? "Health" : "Morale") +
      (direction === "gain" ? " +1" : " −1");
    note.appendChild(item);
    any = true;
  });

  return any ? note : null;
}

/* A speaker naming a skill drives both its colour and the scene thumbnail; a
   bare check falls back to the skill being rolled. */
export function voiceOf(node) {
  return (
    findSkill(node.speaker) ||
    (node.skillCheck ? findSkill(node.skillCheck.skill) : null)
  );
}

export function buildEntry(node, voice, speakKey) {
  const article = document.createElement("article");
  article.className = "entry dialogue";
  article.dataset.node = node.id;
  if (node.skillCheck && node.skillCheck.result) {
    article.dataset.result = node.skillCheck.result;
  }

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
    if (lead.childNodes.length) lead.appendChild(document.createTextNode(" "));
    lead.appendChild(checkTag(node.skillCheck));
  }

  if (lead.childNodes.length && node.dialogue) {
    lead.appendChild(document.createTextNode(" — "));
  }

  const body = document.createElement("span");
  body.className = "entry-body";
  paintMarkup(body, node.dialogue);
  lead.appendChild(body);

  if (node.dialogue && narration.isNarrator(node.speaker)) {
    article.dataset.narrated = "true";
    lead.appendChild(document.createTextNode(" "));
    lead.appendChild(speakButton(speakKey, node.dialogue));
  }

  article.appendChild(lead);
  return article;
}
