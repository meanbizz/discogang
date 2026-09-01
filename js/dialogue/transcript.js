/* A round that is already over, written back into the log: the same lines,
   nothing to press, nothing spent, no sound. The reader is untouched. */

import { dom } from "../dom.js";
import { own, pick } from "./text.js";
import { MAX_NODES, pickTree } from "./sanitize.js";
import { appendToLog, buildEntry, vitalsNote, voiceOf } from "./entry.js";

/* How far a restored entry is held back from the live scene. Inline on
   purpose: the stylesheet knows nothing about transcripts. */
const HISTORY_OPACITY = "0.78";

/* Every node a round could reach, root first, each one once. A save records
   the trees, not which fork was taken, so both sides of a choice show. */
function walk(tree) {
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
    out.push(node);

    const branches = [];
    if (node.next) branches.push(node.next);
    for (let i = 0; i < node.options.length; i += 1) {
      if (node.options[i].next) branches.push(node.options[i].next);
    }
    /* Depth first, so a fork's own line stays directly under it. */
    for (let j = branches.length - 1; j >= 0; j -= 1) {
      queue.unshift(branches[j]);
    }
  }
  return out;
}

function pastChoices(options) {
  const host = document.createElement("div");
  host.className = "entry-choices";
  host.dataset.spent = "true";
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.disabled = true;
    button.textContent = option.label;
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

/* round is one entry of the history: { id, at, payload }. Returns how many
   lines were written, 0 when the round holds no tree for this reader. */
export function renderRound(round, selfId, name) {
  if (!dom.log || !round || !round.payload) return 0;

  const mine = pickTree(round.payload, selfId, name);
  if (!mine) return 0;

  const nodes = walk(mine);
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

    const note = vitalsNote(node.vitals, false);
    if (note) article.appendChild(note);

    if (node.options.length) article.appendChild(pastChoices(node.options));

    appendToLog(article);
  }

  dom.log.scrollTop = dom.log.scrollHeight;
  return nodes.length;
}
