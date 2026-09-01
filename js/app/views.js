/* Everything painted outside the dialogue reader: status, roster, session
   log, plan log, and the ready controls. */

import { HISTORY_LIMIT, TURN_LIMIT } from "../config.js";
import { dom } from "../dom.js";
import { copyText, paintMarkup, paintThumb } from "../utils.js";
import { state, everyoneReady, slotOf } from "./state.js";
import { refreshPlanningLock, refreshSpeakLock } from "./locks.js";

export function setStatus(kind, text) {
  dom.statusDot.setAttribute("data-state", kind);
  dom.statusText.textContent = text;
}

export function systemNote(text) {
  renderEntry({ system: true, text, at: Date.now() });
}

export function renderRoster() {
  dom.roster.textContent = "";
  renderReadyBanner();
  refreshPlanningLock();

  const people = [];
  state.roster.forEach((person) => {
    if (!person.admin) people.push(person);
  });

  if (!people.length) {
    const empty = document.createElement("p");
    empty.className = "roster-empty";
    empty.textContent = "Nobody here yet.";
    dom.roster.appendChild(empty);
    return;
  }

  people.forEach((person) => {
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className = "roster-person";
    wrapper.dataset.personId = person.id;
    if (person.id === state.selfId) wrapper.classList.add("self");
    wrapper.dataset.slot = String(person.slot || 0);

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    paintThumb(thumb, person);

    const name = document.createElement("span");
    name.className = "roster-name";
    name.textContent = person.name;

    const readyDot = document.createElement("span");
    readyDot.className = "roster-ready";
    if (person.ready) readyDot.setAttribute("data-ready", "true");

    wrapper.appendChild(thumb);
    wrapper.appendChild(name);
    wrapper.appendChild(readyDot);
    wrapper.title = person.name;
    wrapper.setAttribute("aria-label", `Portrait of ${person.name}`);
    dom.roster.appendChild(wrapper);
  });
}

export function renderReadyBanner() {
  dom.readyBanner.hidden = !(state.isAdmin && everyoneReady());
  refreshSpeakLock();
}

export function paintReadyButton() {
  dom.turnReady.textContent = state.selfReady ? "Ready ✓" : "Ready";
  dom.turnReady.setAttribute(
    "aria-pressed",
    state.selfReady ? "true" : "false",
  );
  dom.turnReady.classList.toggle("is-ready", state.selfReady);
}

/* Lifts a raw payload back out of the log. */
function rawCopyButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entry-copy";
  button.textContent = "Copy";
  button.title = "Copy this payload";
  button.setAttribute("aria-label", "Copy this payload");

  let resetTimer = null;
  button.addEventListener("click", () => {
    copyText(text, (ok) => {
      button.textContent = ok ? "Copied ✓" : "Failed";
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    });
  });

  return button;
}

export function renderEntry(entry) {
  const placeholder = dom.log.querySelector(".log-empty");
  if (placeholder) placeholder.remove();

  const previous = dom.log.querySelector(".entry.current");
  if (previous) previous.classList.remove("current");

  const wrapper = document.createElement("article");
  wrapper.className = "entry current";
  if (entry.system) wrapper.classList.add("system");

  if (entry.raw) {
    wrapper.classList.add("raw");
    const label = document.createElement("p");
    label.className = "entry-label";
    label.textContent = "Turn payload sent";
    wrapper.appendChild(label);
    wrapper.appendChild(rawCopyButton(entry.text));
  }

  /* An entry naming a round carries that round's payload on its copy button,
     rather than in text cleanText would truncate. */
  if (entry.roundId && state.isAdmin) {
    const held = state.dialogueRounds.find(
      (round) => round.id === entry.roundId,
    );
    if (held) {
      wrapper.classList.add("raw");
      wrapper.appendChild(rawCopyButton(JSON.stringify(held.payload, null, 2)));
    }
  }

  const body = document.createElement("p");
  body.className = "entry-body";
  body.textContent = entry.text;
  wrapper.appendChild(body);

  const pinned =
    dom.log.scrollTop + dom.log.clientHeight >= dom.log.scrollHeight - 48;
  dom.log.appendChild(wrapper);
  if (pinned) dom.log.scrollTop = dom.log.scrollHeight;
}

export function commit(entry) {
  state.logEntries.push(entry);
  if (state.logEntries.length > HISTORY_LIMIT) state.logEntries.shift();
  renderEntry(entry);
}

export function replaceLog(entries) {
  state.logEntries = entries.slice(-HISTORY_LIMIT);
  dom.log.textContent = "";
  state.logEntries.forEach(renderEntry);
  if (!state.logEntries.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "log-empty";
    placeholder.textContent =
      "The log is empty. Somebody should say something.";
    dom.log.appendChild(placeholder);
  }
  dom.log.scrollTop = dom.log.scrollHeight;
}

export function renderTurn(entry) {
  const placeholder = dom.turnLog.querySelector(".turn-empty");
  if (placeholder) placeholder.remove();

  const slot = String(slotOf(entry.authorId, entry.author));
  const line = document.createElement("p");
  line.className = "turn-line";

  const author = document.createElement("span");
  author.className = "turn-author";
  author.textContent = entry.author;
  author.dataset.slot = slot;
  line.appendChild(author);
  line.appendChild(document.createTextNode(" — "));

  const body = document.createElement("span");
  body.className = "turn-body";
  paintMarkup(body, entry.text);
  line.appendChild(body);

  const wrapper = document.createElement("article");
  wrapper.className = "turn-entry";
  wrapper.dataset.slot = slot;
  if (entry.stale) wrapper.dataset.stale = "true";
  if (entry.roundEnd) wrapper.dataset.roundEnd = "true";
  wrapper.appendChild(line);

  const pinned =
    dom.turnLog.scrollTop + dom.turnLog.clientHeight >=
    dom.turnLog.scrollHeight - 32;
  dom.turnLog.appendChild(wrapper);
  if (pinned) dom.turnLog.scrollTop = dom.turnLog.scrollHeight;
}

export function commitTurn(entry) {
  state.turnEntries.push(entry);
  if (state.turnEntries.length > TURN_LIMIT) state.turnEntries.shift();
  renderTurn(entry);
}

export function replaceTurnLog(entries) {
  state.turnEntries = entries.slice(-TURN_LIMIT);
  dom.turnLog.textContent = "";
  state.turnEntries.forEach(renderTurn);
  if (!state.turnEntries.length) renderTurnEmptyState();
  dom.turnLog.scrollTop = dom.turnLog.scrollHeight;
}

export function renderTurnEmptyState() {
  if (dom.turnLog.children.length) return;
  const placeholder = document.createElement("p");
  placeholder.className = "turn-empty";
  placeholder.textContent = "Nothing planned yet.";
  dom.turnLog.appendChild(placeholder);
}
