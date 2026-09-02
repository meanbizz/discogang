/* A round that is already over, written back into the log: the same lines,
   nothing to press, nothing spent, no sound. The reader is untouched.

   A round that recorded what the player chose is read back along that path
   only, with the option they took still marked. A round with nothing recorded
   — anything saved before choices were kept — shows both sides of every fork,
   as it always did.

   Experience is shown as it was earned and never earned again: the ledger it
   went into was saved beside the round. */

import { dom } from "../dom.js";
import { own, pick } from "./text.js";
import { MAX_NODES, pickTree } from "./sanitize.js";
import { blocksNode } from "./passive.js";
import { chosenByNode, chosenIndex } from "./choices.js";
import { appendToLog, buildEntry, vitalsNote, voiceOf } from "./entry.js";

/* How far a restored entry is held back from the live scene. Inline on
   purpose: the stylesheet knows nothing about transcripts. */
const HISTORY_OPACITY = "0.78";

/* Every node a round reached, root first, each one once.

   Passives the reader was not sharp enough for are stepped over exactly as
   the live reader steps over them, so a transcript holds what the player saw
   and nothing they did not. */
function walk(tree, taken) {
  if (!tree || !tree.nodes) return [];

  const out = [];
  const seen = {};
  const queue = [tree.root];

  while (queue.length && out.length < MAX_NODES) {
    const id = queue.shift();
    if (!id || own(seen, id)) continue;
    const node = pick(tree.nodes, id);
    if (!node) continue;

    seen[id] = true;
    const unnoticed = blocksNode(node);
    if (!unnoticed) out.push(node);

    const branches = [];
    if (node.next) branches.push(node.next);

    if (!unnoticed && node.options.length) {
      const choice = pick(taken, id);
      const picked = chosenIndex(node.options, choice);
      if (picked >= 0) {
        /* The fork was answered: only the answer's subtree was ever read. */
        const followed = node.options[picked].next;
        if (followed) branches.push(followed);
      } else {
        for (let i = 0; i < node.options.length; i += 1) {
          if (node.options[i].next) branches.push(node.options[i].next);
        }
      }
    }

    /* Depth first, so a fork's own line stays directly under it. */
    for (let j = branches.length - 1; j >= 0; j -= 1) {
      queue.unshift(branches[j]);
    }
  }
  return out;
}

/* The row as it was left: nothing to press, and the option taken still
   legible among the ones that were not. */
function pastChoices(options, choice) {
  const host = document.createElement("div");
  host.className = "entry-choices";
  host.dataset.spent = "true";

  const picked = chosenIndex(options, choice);

  options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.disabled = true;
    button.textContent = index + 1 + ". " + option.label;
    if (index === picked) button.classList.add("is-chosen");
    host.appendChild(button);
  });
  return host;
}

/* Whether a round holds a scene for this reader at all, asked before the
   caller promises one. */
export function hasTreeFor(round, selfId, name) {
  return Boolean(
    round && round.payload && pickTree(round.payload, selfId, name),
  );
}

/* round is one entry of the history: { id, at, payload, choices }. Returns how
   many lines were written, 0 when the round holds no tree for this reader. */
export function renderRound(round, selfId, name) {
  if (!dom.log || !round || !round.payload) return 0;

  const mine = pickTree(round.payload, selfId, name);
  if (!mine) return 0;

  const taken = chosenByNode(round, name);
  const nodes = walk(mine, taken);
  if (!nodes.length) return 0;

  const stamp = round.id ? String(round.id) : "past";

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const article = buildEntry(
      node,
      voiceOf(node),
      "past:" + stamp + ":" + node.id,
    );
    article.dataset.history = "true";
    article.style.opacity = HISTORY_OPACITY;

    /* apply is false, so the note reads as a record: no vitals move, and the
       experience is only being remembered. */
    const note = vitalsNote(node.vitals, false, node.xpGained);
    if (note) article.appendChild(note);

    if (node.options.length) {
      article.appendChild(pastChoices(node.options, pick(taken, node.id)));
    }

    appendToLog(article);
  }

  dom.log.scrollTop = dom.log.scrollHeight;
  return nodes.length;
}
