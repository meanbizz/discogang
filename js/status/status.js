/* js/status/status.js */

/* Who is on the floor and who is past picking up: two rolls of character
   names, and the orders an administrateur's payload writes them with.

   A name is the identity here, read case-insensitively, the same way a goal
   book names its holder — peer ids die with a session, names do not. Dead
   outranks down, so a name on the K.I.A. roll is never also on the other.

   An order replaces the roll it names outright and leaves the roll it says
   nothing about alone, which is what makes a revival an omission rather than
   a verb of its own. No DOM, no network. */

export const DOWN_KEY = "down";
export const KIA_KEY = "kia";

const NAME_MAX = 48;
const MAX_NAMES = 32;

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

export function statusName(value) {
  return line(fold(value), NAME_MAX);
}

function nameKey(value) {
  return statusName(value).toLowerCase();
}

/* One roll: names only, deduped and capped. A bare string or a { name } both
   read as the same person. */
export function cleanRoll(raw) {
  const source = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < source.length && out.length < MAX_NAMES; i += 1) {
    const one = source[i];
    const name = statusName(
      typeof one === "string" ? one : one && typeof one === "object" && one.name,
    );
    if (!name) continue;
    const at = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(seen, at)) continue;
    seen[at] = true;
    out.push(name);
  }
  return out;
}

export function holds(roll, name) {
  const wanted = nameKey(name);
  if (!wanted || !Array.isArray(roll)) return false;
  for (let i = 0; i < roll.length; i += 1) {
    if (nameKey(roll[i]) === wanted) return true;
  }
  return false;
}

/* Both rolls as a room holds them: nobody is on the floor and in the ground
   at the same time. */
export function cleanStatus(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const kia = cleanRoll(source[KIA_KEY]);
  return {
    down: cleanRoll(source[DOWN_KEY]).filter((name) => !holds(kia, name)),
    kia,
  };
}

/* What a payload wrote and nothing else: a roll it never named comes back
   null, so it can be left exactly as it stands. */
export function cleanStatusOrders(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = { down: null, kia: null };
  Object.keys(raw).forEach((field) => {
    const at = nameKey(field);
    if (at === DOWN_KEY) out.down = cleanRoll(raw[field]);
    else if (at === KIA_KEY) out.kia = cleanRoll(raw[field]);
  });
  return out.down || out.kia ? out : null;
}

/* A fresh pair of rolls; the argument is left alone. An empty array is still
   an order — it is how a whole roll is cleared. */
export function applyStatusOrders(rolls, orders) {
  const held = cleanStatus(rolls);
  if (!orders) return held;
  return cleanStatus({
    down: orders.down ? orders.down : held.down,
    kia: orders.kia ? orders.kia : held.kia,
  });
}
