/* js/overlays.js */

/* The notice plate: the announcements that are neither the dice nor
   experience. Money was the first — the coins, MONEY GAINED or MONEY LOST,
   and what moved underneath in full caps — and health and morale followed,
   each a picture that names itself and needs no words set under it.

   Nothing here decides that anything happened; it is told. app/inventory.js
   watches this seat's purse across every live change and calls money() with
   the difference; js/vitals.js calls vital() once a bar has actually moved.

   Every plate goes through js/sequencer.js rather than straight onto the
   screen. That matters more than it looks: the administrateur's payload moves
   items before it sends the trees that mention them, so a payment and the
   scene it belongs to arrive on consecutive frames. Queued, the plate is read
   first and the scene follows; unqueued, it would have landed under the dice.

   The cue is fired as the plate goes up rather than when the message arrived,
   for the same reason — coins heard with nothing on screen are coins nobody
   can account for. */

import { dom } from "./dom.js";
import { TIMING } from "./timing.js";
import * as sfx from "./audio/sfx.js";
import * as sequencer from "./sequencer.js";
import { CURRENCY_NAME } from "./inventory/items.js";

/* Its own group on the lane, so a round beginning cannot cancel it: money
   that arrived with the payload that opened the scene is not the scene's to
   withdraw, and neither is a step of health it spent. Only leaving the room
   drops them. */
const GROUP = "notice";

const MONEY_ART = "images/money.png";

/* Health and morale, spent and restored. */
const VITAL_ART = {
  health: {
    gain: "images/healed_health.png",
    loss: "images/damaged_health.png",
  },
  morale: {
    gain: "images/healed_morale.png",
    loss: "images/damaged_morale.png",
  },
};

/* The plate carries no words for these, so the picture carries them instead —
   for whoever is listening rather than looking. */
const VITAL_ALT = {
  health: { gain: "Health restored", loss: "Health damaged" },
  morale: { gain: "Morale restored", loss: "Morale damaged" },
};

function href(path) {
  return new URL(path, window.location.href).href;
}

function totalMs() {
  return TIMING.notice.inMs + TIMING.notice.holdMs + TIMING.notice.outMs;
}

/* The plate's pieces: off the dom map where it carries them, off the document
   where it does not. One host with three children, and a name missing from the
   map should not cost the whole plate. */
function parts() {
  const host = dom.noticeOverlay || document.getElementById("notice-overlay");
  if (!host) return null;
  return {
    host,
    art: dom.noticeArt || host.querySelector(".notice-art"),
    title: dom.noticeTitle || host.querySelector(".notice-title"),
    amount: dom.noticeAmount || host.querySelector(".notice-amount"),
  };
}

export function hide() {
  const face = parts();
  if (!face) return;
  face.host.classList.remove("is-in", "is-out");
  face.host.hidden = true;
}

function run(plate, timers, done) {
  const face = parts();
  if (!face) {
    done();
    return;
  }
  const host = face.host;

  host.dataset.kind = plate.kind || "";
  /* Which way it went. animations.css reads nothing else to decide whether
     the art rises or sinks, so money, health and morale all travel alike. */
  if (plate.way) host.dataset.way = plate.way;
  else delete host.dataset.way;

  if (face.art) {
    if (plate.art) {
      face.art.src = href(plate.art);
      face.art.alt = plate.alt || "";
      face.art.hidden = false;
    } else {
      face.art.hidden = true;
      face.art.removeAttribute("src");
      face.art.alt = "";
    }
  }
  if (face.title) {
    face.title.textContent = plate.title || "";
    face.title.hidden = !plate.title;
  }
  if (face.amount) {
    face.amount.textContent = plate.amount || "";
    face.amount.hidden = !plate.amount;
  }

  host.classList.remove("is-in", "is-out");
  host.hidden = false;
  /* The art's own animation restarts with the display flip. */
  void host.offsetWidth;
  host.classList.add("is-in");

  if (plate.sound) plate.sound();

  timers.after(TIMING.notice.inMs + TIMING.notice.holdMs, () => {
    host.classList.remove("is-in");
    host.classList.add("is-out");
    timers.after(TIMING.notice.outMs, () => {
      host.classList.remove("is-out");
      host.hidden = true;
      done();
    });
  });
}

/* plate is { kind, art, alt, title, amount, way, sound }. A title or a
   picture is enough to be news; everything else is optional. */
export function notice(plate) {
  if (!plate || (!plate.title && !plate.art)) return;
  if (!parts()) return;

  const timers = sequencer.clock();
  sequencer.enqueue({
    name: plate.kind,
    group: GROUP,
    timeoutMs: totalMs(),
    run: (done) => run(plate, timers, done),
    cancel: () => {
      timers.stop();
      hide();
    },
  });
}

/* delta is the change to this seat's purse, positive or negative. Nothing
   moving is not news. */
export function money(delta) {
  const amount = Math.round(Number(delta) || 0);
  if (!amount) return;
  const gained = amount > 0;

  notice({
    kind: gained ? "money-gain" : "money-loss",
    art: MONEY_ART,
    alt: gained ? "Money gained" : "Money lost",
    way: gained ? "gain" : "loss",
    title: gained ? "MONEY GAINED" : "MONEY LOST",
    /* The sign leads: which way it went matters before how much. */
    amount:
      (gained ? "+" : "−") +
      Math.abs(amount) +
      " " +
      CURRENCY_NAME.toUpperCase(),
    sound: () => sfx.playMoney(gained),
  });
}

/* One step of health or morale: vitals.js moved the bar and this is the announcement.
   Queued like every other plate, firing its cue as the plate goes up. */
export function vital(kind, gained, amount) {
  if (!Object.prototype.hasOwnProperty.call(VITAL_ART, kind)) return;
  const way = gained ? "gain" : "loss";
  const qty = Math.abs(Math.round(Number(amount))) || 1;
  const name = kind === "health" ? "HEALTH" : "MORALE";

  notice({
    kind: kind + "-" + way,
    art: VITAL_ART[kind][way],
    alt: VITAL_ALT[kind][way],
    way,
    amount: (gained ? "+" : "−") + qty + " " + name,
    sound: () => sfx.playVital(kind, gained),
  });
}

/* A goal finished, and what completing it paid. A notice rather than the
   experience overlay: that belongs to the scene's group, and a round opening
   on the next frame would withdraw a plate the goal had already earned.

   No art by default — the name is the sentence. */
export function goal(name, gained, granted) {
  const title = String(name == null ? "" : name).trim();
  if (!title) return;
  /* A point is the news when one landed; the experience under it is not. */
  const cue = granted ? sfx.playPoint : gained ? sfx.playXp : null;

  notice({
    kind: "goal",
    way: "gain",
    title: "GOAL COMPLETED",
    amount: title.toUpperCase() + (gained ? " — +" + gained + " XP" : ""),
    sound: cue ? () => cue(null) : null,
  });
}

/* ---------------- The goal-gained plate ---------------- */

/* A goal arriving in this seat's book: the administrateur's payload has just
   written something new for them. Its own plate, on the notice group, so a
   round opening on the next frame cannot withdraw it. */
const GOAL_ART = "images/task_gained.png";

function goalParts() {
  const host = dom.goalOverlay || document.getElementById("goal-overlay");
  if (!host) return null;
  return {
    host,
    art: dom.goalArt || host.querySelector(".goal-art"),
    title: dom.goalTitle || host.querySelector(".goal-title"),
    amount: dom.goalAmount || host.querySelector(".goal-amount"),
  };
}

export function hideGoal() {
  const face = goalParts();
  if (!face) return;
  face.host.classList.remove("is-in", "is-out");
  face.host.hidden = true;
}

function runGoal(name, timers, done) {
  const face = goalParts();
  if (!face) {
    done();
    return;
  }
  const host = face.host;

  if (face.art) {
    face.art.src = href(GOAL_ART);
    face.art.alt = "";
    face.art.hidden = false;
  }
  if (face.title) {
    face.title.textContent = "NEW GOAL";
    face.title.hidden = false;
  }
  if (face.amount) {
    face.amount.textContent = name;
    face.amount.hidden = !name;
  }

  host.classList.remove("is-in", "is-out");
  host.hidden = false;
  /* The vignette's own animation restarts with the display flip. */
  void host.offsetWidth;
  host.classList.add("is-in");

  /* Something gained rather than spent: the cue a new skill point answers
     with, since a goal is the same kind of news. */
  sfx.playPoint(null);

  timers.after(TIMING.xp.inMs + TIMING.xp.holdMs, () => {
    host.classList.remove("is-in");
    host.classList.add("is-out");
    timers.after(TIMING.xp.outMs, () => {
      host.classList.remove("is-out");
      host.hidden = true;
      done();
    });
  });
}

/* goal is one entry of this seat's book, as cleanGoal built it. */
export function goalAdded(goal) {
  const name = String(goal && goal.name != null ? goal.name : "")
    .trim()
    .toUpperCase();
  if (!name || !goalParts()) return;

  const timers = sequencer.clock();
  sequencer.enqueue({
    name: "goal-added",
    group: GROUP,
    timeoutMs: totalMs(),
    run: (done) => runGoal(name, timers, done),
    cancel: () => {
      timers.stop();
      hideGoal();
    },
  });
}

/* Arriving in a room or leaving one: nothing still on its way belongs to it,
   and no voice still ringing for it either. */
export function reset() {
  sequencer.clear(GROUP);
  sfx.stopNotices();
  hide();
  hideGoal();
}
