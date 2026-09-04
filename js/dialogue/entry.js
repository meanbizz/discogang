/* js/dialogue/entry.js */

/* One dialogue line as a DOM node: speaker, verdict tag, body, the vitals and
   experience note, and the narrator's read-aloud button. A live node and a
   restored one are the same article; only what is appended after differs. */

import { dom } from "../dom.js";
import { paintMarkup } from "../utils.js";
import * as vitals from "../vitals.js";
import * as narration from "../audio/narration.js";
import { DIFFICULTY_TARGET } from "./sanitize.js";
import { PASSIVE_BONUS, passiveScore, skillValue } from "./passive.js";
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

function capitalize(value) {
  const text = String(value == null ? "" : value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* "+2" / "−1" / "none" — a modifier reads as a direction, not a bare number. */
function signed(value) {
  const number = Number(value) || 0;
  if (!number) return "none";
  return (number > 0 ? "+" : "−") + Math.abs(number);
}

/* What the tag says when it is hovered. Every number is named: which die was
   which, what the modifier did, what the target was, and what the three came
   to together. A bare "3 + 4 + 2 = 9" leaves the reader to guess which of
   those was the roll and which the sheet.

   A pair against its target is the whole of a verdict: there are no critical
   faces here, so nothing is read into two sixes beyond the twelve they add
   up to. */
function checkTitle(check) {
  const lines = [];

  if (check.difficulty) {
    const target = DIFFICULTY_TARGET[check.difficulty];
    lines.push(
      "Difficulty: " +
        capitalize(check.difficulty) +
        (target ? " — " + target + " or more to pass" : ""),
    );
  }

  if (check.passive) {
    /* No dice were thrown, so the sheet and the standing bonus are the whole
       of the roll. */
    const score = skillValue(check);
    const total = passiveScore(check);
    lines.push("Read passively — no dice");
    if (score != null) {
      lines.push("Skill: " + skillLabel(check.skill) + " " + score);
    }
    lines.push("Passive bonus: +" + PASSIVE_BONUS + " in place of two dice");
    lines.push("Modifier: " + signed(check.modifier));
    if (total != null) lines.push("Total: " + total);
    return lines.join("\n");
  }

  if (check.dice1 && check.dice2) {
    /* The pair, the sheet and the modifier together. A reader who loaded no
       sheet rolls on the dice and the modifier alone. */
    const score = skillValue(check);
    lines.push("Rolled: " + check.dice1 + " and " + check.dice2);
    if (score != null) {
      lines.push("Skill: " + skillLabel(check.skill) + " " + score);
    }
    lines.push("Modifier: " + signed(check.modifier));
    lines.push(
      "Total: " + (check.dice1 + check.dice2 + (score || 0) + check.modifier),
    );
    return lines.join("\n");
  }

  if (check.modifier) lines.push("Modifier: " + signed(check.modifier));
  return lines.join("\n");
}

/* [Medium 10+: success], with the breakdown as a title. */
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
  tag.title = checkTitle(check);

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

/* What a line cost and what it was worth, on one row.

   apply is what separates a scene being played from one being read back: a
   transcript shows the same note without spending anybody's vitals. The
   experience is only ever labelled here — the ledger is moved by the reader,
   which needs to know what landed before it can announce it. */
export function vitalsNote(effect, apply, xpGained) {
  const note = document.createElement("p");
  note.className = "vitals-note";
  let any = false;

  if (effect) {
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
  }

  const gained = Math.round(Number(xpGained)) || 0;
  if (gained > 0) {
    const item = document.createElement("span");
    item.className = "vitals-note-item";
    item.dataset.vital = "xp";
    item.textContent = "+" + gained + " XP: gained experience.";
    note.appendChild(item);
    any = true;
  }

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

  /* A line that is nothing but style has nothing to read aloud, so it is not
     offered a button it could only fail with. */
  if (
    node.dialogue &&
    narration.isNarrator(node.speaker) &&
    narration.speakable(node.dialogue)
  ) {
    article.dataset.narrated = "true";
    lead.appendChild(document.createTextNode(" "));
    lead.appendChild(speakButton(speakKey, node.dialogue));
  }

  article.appendChild(lead);
  return article;
}
