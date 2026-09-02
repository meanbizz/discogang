/* js/goals/goals.js */

/* Goals and who carries them. A goal is named, described, and worth some
   experience on completion; a holder's book is an ordered list of them.

   Unlike an item, a goal is nobody else's business: there is no catalogue and
   no administrateur's list, so the whole of a goal lives in the book of the
   character it belongs to. The name is the identity, read case-insensitively,
   which is what lets an order mark one done without repeating what it says.

   An administrateur's payload may carry add/update/remove/complete orders
   under the reserved "goals" key, keyed by character name or "*" for the whole
   table; they are rebuilt here before anything moves. No DOM, no network. */

export const GOALS_KEY = "goals";

const NAME_MAX = 80;
const DESC_MAX = 600;
const HOLDER_MAX = 48;
const MAX_GOALS = 64;
const MAX_HOLDERS = 32;
const XP_MAX = 9999;

/* Targets that mean every player at the table. */
const EVERYONE = { "*": true, all: true, everyone: true, players: true };

function has(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

/* Composed first, so an accent written as two characters off the wire matches
   the same name written as one. */
function fold(value) {
  const text = String(value == null ? "" : value);
  try {
    return text.normalize ? text.normalize("NFC") : text;
  } catch (error) {
    return text;
  }
}

function line(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function body(value, max) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/* The first field a payload actually wrote, which is what keeps "said
   nothing" apart from "said none". */
function first(values) {
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] != null) return values[i];
  }
  return null;
}

function reward(value) {
  const number = Math.round(Number(value));
  if (!isFinite(number) || number <= 0) return 0;
  return Math.min(XP_MAX, number);
}

export function goalName(value) {
  return line(fold(value), NAME_MAX);
}

export function goalKey(value) {
  return goalName(value).toLowerCase();
}

function holderKey(value) {
  return line(fold(value), HOLDER_MAX).toLowerCase();
}

export function cleanGoal(raw) {
  const source = typeof raw === "string" ? { name: raw } : raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const name = goalName(first([source.name, source.title, source.goal]));
  if (!name) return null;
  return {
    name,
    description: body(first([source.description, source.text]), DESC_MAX),
    xp: reward(first([source.xp, source.xpGained, source.reward])),
    done: Boolean(first([source.done, source.complete, source.completed])),
  };
}

export function cleanGoals(raw) {
  const source = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < source.length && out.length < MAX_GOALS; i += 1) {
    const goal = cleanGoal(source[i]);
    if (!goal) continue;
    const key = goal.name.toLowerCase();
    if (has(seen, key)) continue;
    seen[key] = true;
    out.push(goal);
  }
  return out;
}

/* { "Harry": [ … ] } — every book at the table, rebuilt. */
export function cleanGoalBooks(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  const holders = Object.keys(raw);
  let kept = 0;
  for (let i = 0; i < holders.length && kept < MAX_HOLDERS; i += 1) {
    const holder = line(fold(holders[i]), HOLDER_MAX);
    if (!holder || has(out, holder)) continue;
    out[holder] = cleanGoals(raw[holders[i]]);
    kept += 1;
  }
  return out;
}

/* One character's book, matched on the name however it was capitalised. */
export function goalsFor(books, holder) {
  const key = holderKey(holder);
  if (!key || !books || typeof books !== "object") return [];
  const holders = Object.keys(books);
  for (let i = 0; i < holders.length; i += 1) {
    if (holderKey(holders[i]) !== key) continue;
    return Array.isArray(books[holders[i]]) ? books[holders[i]] : [];
  }
  return [];
}

/* An order carries what it means to change and nothing else: wrote is what
   stops an unwritten field from erasing what a book already says. */
function order(raw) {
  const goal = cleanGoal(raw);
  if (!goal) return null;
  const source = typeof raw === "string" ? {} : raw;
  goal.wrote = {
    description: first([source.description, source.text]) != null,
    xp: first([source.xp, source.xpGained, source.reward]) != null,
    done: first([source.done, source.complete, source.completed]) != null,
  };
  return goal;
}

function orders(raw) {
  const source = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (let i = 0; i < source.length && out.length < MAX_GOALS; i += 1) {
    const kept = order(source[i]);
    if (kept) out.push(kept);
  }
  return out;
}

/* "complete": ["Find the gun"] — an update that says nothing but done. */
function completed(list) {
  list.forEach((goal) => {
    goal.done = true;
    goal.wrote.done = true;
  });
  return list;
}

/* { "Harry": { add: […], update: […], remove: […] } }. A bare array under a
   holder reads as "add"; "*" means every player. Null when nothing holds up. */
export function cleanGoalOps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  const targets = Object.keys(raw);
  let kept = 0;

  for (let i = 0; i < targets.length && kept < MAX_HOLDERS; i += 1) {
    const target = line(fold(targets[i]), HOLDER_MAX);
    const source = raw[targets[i]];
    if (!target || !source || typeof source !== "object") continue;

    const asked = Array.isArray(source)
      ? { add: orders(source), update: [], remove: [] }
      : {
          add: orders(source.add || source.give),
          update: orders(source.update || source.set).concat(
            completed(orders(source.complete || source.completed)),
          ),
          remove: orders(source.remove || source.take || source.drop),
        };
    if (!asked.add.length && !asked.update.length && !asked.remove.length) {
      continue;
    }
    out[target] = asked;
    kept += 1;
  }
  return kept ? out : null;
}

function bookFor(books, holder) {
  const key = holderKey(holder);
  const holders = Object.keys(books);
  for (let i = 0; i < holders.length; i += 1) {
    if (holderKey(holders[i]) === key) return books[holders[i]];
  }
  books[holder] = [];
  return books[holder];
}

function held(book, name) {
  const key = goalKey(name);
  for (let i = 0; i < book.length; i += 1) {
    if (goalKey(book[i].name) === key) return book[i];
  }
  return null;
}

/* What the order wrote lands; what it left out keeps whatever the book
   already said. */
function write(book, asked) {
  const found = held(book, asked.name);
  if (!found) {
    if (book.length >= MAX_GOALS) return;
    book.push({
      name: asked.name,
      description: asked.description,
      xp: asked.xp,
      done: asked.done,
    });
    return;
  }
  if (asked.wrote.description) found.description = asked.description;
  if (asked.wrote.xp) found.xp = asked.xp;
  if (asked.wrote.done) found.done = asked.done;
}

function drop(book, asked) {
  const key = goalKey(asked.name);
  for (let i = book.length - 1; i >= 0; i -= 1) {
    if (goalKey(book[i].name) === key) book.splice(i, 1);
  }
}

/* Returns a fresh set of books; the argument is left alone. */
export function applyGoalOps(books, ops, everyone) {
  const out = cleanGoalBooks(books);
  if (!ops) return out;

  Object.keys(ops).forEach((target) => {
    const holders = has(EVERYONE, holderKey(target))
      ? everyone || []
      : [target];
    holders.forEach((holder) => {
      const name = line(fold(holder), HOLDER_MAX);
      if (!name) return;
      const book = bookFor(out, name);
      const asked = ops[target];
      asked.add.forEach((one) => write(book, one));
      asked.update.forEach((one) => write(book, one));
      asked.remove.forEach((one) => drop(book, one));
    });
  });
  return out;
}
