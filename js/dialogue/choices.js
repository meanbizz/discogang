/* js/dialogue/choices.js */

/* What a reader picked, and where. A round records every reader's choices
   under the character name that made them — peer ids do not survive a save,
   names do.

   No DOM and no network here: cleanChoices is what a peer's claim is rebuilt
   through, and the lookups are what the transcript reads back. */

import { own, line, normalizeKey } from "./text.js";

const NAME_MAX = 24;
const KEY_MAX = 120;
const LABEL_MAX = 240;
const MAX_READERS = 32;
const MAX_PER_READER = 240;

export function cleanChoice(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const nodeId = line(raw.nodeId, KEY_MAX);
  if (!nodeId) return null;

  /* The number the option was offered under, 1-based, or 0 when it is not
     worth trusting. */
  let index = Math.round(Number(raw.index));
  if (!isFinite(index) || index < 1 || index > 64) index = 0;

  return {
    nodeId,
    optionId: line(raw.optionId, KEY_MAX),
    label: line(raw.label, LABEL_MAX),
    index,
    at: Number(raw.at) || 0,
  };
}

/* A node can only be answered once, so a later answer for the same node
   replaces the earlier one rather than piling up beside it. */
export function keepChoice(list, choice) {
  if (!Array.isArray(list) || !choice) return list;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].nodeId === choice.nodeId) {
      list[i] = choice;
      return list;
    }
  }
  list.push(choice);
  return list;
}

/* { "Harry": [choice, …] } — one list per reader, in the order chosen. */
export function cleanChoices(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  const names = Object.keys(raw);
  let kept = 0;

  for (let i = 0; i < names.length && kept < MAX_READERS; i += 1) {
    const author = line(names[i], NAME_MAX);
    if (!author || own(out, author)) continue;
    const list = raw[names[i]];
    if (!Array.isArray(list)) continue;

    const taken = [];
    for (let j = 0; j < list.length && taken.length < MAX_PER_READER; j += 1) {
      const choice = cleanChoice(list[j]);
      if (choice) keepChoice(taken, choice);
    }
    if (!taken.length) continue;
    out[author] = taken;
    kept += 1;
  }
  return out;
}

/* Names travel as they were written, so they are matched as loosely as the
   trees they belong to. */
export function choicesFor(round, name) {
  if (!round || !round.choices) return [];
  const wanted = normalizeKey(name);
  if (!wanted) return [];
  const keys = Object.keys(round.choices);
  for (let i = 0; i < keys.length; i += 1) {
    if (normalizeKey(keys[i]) === wanted) return round.choices[keys[i]];
  }
  return [];
}

/* nodeId -> the choice made there, so a walk can follow only the path that
   was actually taken. */
export function chosenByNode(round, name) {
  const list = choicesFor(round, name);
  const out = {};
  for (let i = 0; i < list.length; i += 1) out[list[i].nodeId] = list[i];
  return out;
}

/* Which of a node's options a choice points at: by id, then by the number it
   was offered under, then by its words. -1 when none of the three land. */
export function chosenIndex(options, choice) {
  if (!Array.isArray(options) || !options.length || !choice) return -1;

  if (choice.optionId) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].id === choice.optionId) return i;
    }
  }
  if (choice.index >= 1 && choice.index <= options.length) {
    return choice.index - 1;
  }
  if (choice.label) {
    for (let j = 0; j < options.length; j += 1) {
      if (options[j].label === choice.label) return j;
    }
  }
  return -1;
}

/* One line of it, for the administrateur's log echo and clipboard. */
export function describeChoice(choice) {
  if (!choice) return "";
  const number = choice.index >= 1 ? choice.index + ". " : "";
  return number + (choice.label || choice.optionId || choice.nodeId);
}
