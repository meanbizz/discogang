/* js/audio/volume.js */

/* One dial per kind of sound — the music deck, the cue clips, the narrator —
   and one master over all three. */

/* A level is a share of the mix the app was written with: 1 is that mix
   untouched, 0 is silence. The mix itself stays in timing.js and config.js. */

const DIALS = { music: 0.7, sfx: 0.7, narration: 0.8 };

let master = 1;
const levels = Object.assign({}, DIALS);
const listeners = [];

function share(value) {
  const number = Number(value);
  if (!isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number));
}

function known(kind) {
  return (
    typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(DIALS, kind)
  );
}

/* Told after every change, so a track or a line already playing follows the
   dial rather than waiting for the next one. */
function announce() {
  for (let i = 0; i < listeners.length; i += 1) {
    try {
      listeners[i]();
    } catch (error) {
      /* a listener's own business */
    }
  }
}

export function kinds() {
  return Object.keys(DIALS);
}

export function masterLevel() {
  return master;
}

export function levelOf(kind) {
  return known(kind) ? levels[kind] : 0;
}

/* What a module multiplies its own written level by. */
export function scale(kind) {
  return master * levelOf(kind);
}

/* One element's volume, ready to assign: 0 to 1, whatever was asked for. */
export function apply(kind, base) {
  return share(share(base) * scale(kind));
}

export function setMaster(level) {
  master = share(level);
  announce();
  return master;
}

export function setLevel(kind, level) {
  if (!known(kind)) return 0;
  levels[kind] = share(level);
  announce();
  return levels[kind];
}

/* Every dial at once, read or written. Anything a set leaves out is left
   exactly where it stands. */
export function all() {
  return Object.assign({ master }, levels);
}

export function set(next) {
  if (!next || typeof next !== "object") return all();
  if (next.master != null) master = share(next.master);
  kinds().forEach((kind) => {
    if (next[kind] != null) levels[kind] = share(next[kind]);
  });
  announce();
  return all();
}

export function reset() {
  master = 1;
  kinds().forEach((kind) => {
    levels[kind] = 1;
  });
  announce();
}

/* Returns the way to stop listening. */
export function onChange(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

/* A door for the console, so a level can be tried without a reload. */
if (typeof window !== "undefined") {
  window.SalonVolume = {
    kinds,
    masterLevel,
    levelOf,
    scale,
    apply,
    setMaster,
    setLevel,
    all,
    set,
    reset,
    onChange,
  };
}
