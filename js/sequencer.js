/* js/sequencer.js */

/* One lane for everything that takes the screen: the dice tape, the check
   verdict, the experience plate, the money notice. Jobs run one at a time, in
   the order they were asked for, so a node that rolls and then hands over
   experience shows the dice first and the words after — and nothing has to add
   up durations to arrange that. Retiming a beat in js/timing.js can no longer
   put two of them on screen at once.

   A job is { name, group, run, cancel, timeoutMs }:

     run(done)   called when the lane is free. Whatever it put on screen, it
                 calls done() once that has left again.
     cancel()    the job was dropped — queued or mid-turn — because the round
                 ended or the seat left. Put the screen back.
     group       what the job belongs to, so a caller can drop its own work
                 without touching anybody else's. A scene ending cancels its
                 own dice and its own overlays; the money that arrived with the
                 payload that opened that scene is not the scene's to cancel,
                 and it keeps its place in the queue.
     timeoutMs   how long the job expects to need. The watchdog is set a
                 little past it, so a done() that never arrives (a dropped
                 animationend, a tab hidden mid-fade) cannot close the lane
                 for the rest of the session.

   whenIdle is for the small movements not worth a turn of their own — a
   vitals bar flashing — which should still not happen underneath the dice.

   No DOM, no durations of its own, and nothing here knows what a check is. */

const WATCHDOG_SLACK_MS = 1200;
const DEFAULT_GROUP = "default";
const ALL = "*";

let lane = [];
let current = null;
let watchdog = null;
let waiters = [];
let serial = 0;

export function isBusy() {
  return Boolean(current) || lane.length > 0;
}

/* A job's own timers, so cancelling one can never drop another's. Kept here
   rather than in each caller because every job needs the same two lines. */
export function clock() {
  let timers = [];
  return {
    after(ms, action) {
      timers.push(setTimeout(action, Math.max(0, Number(ms) || 0)));
    },
    stop() {
      for (let i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
      timers = [];
    },
  };
}

function stopWatchdog() {
  if (!watchdog) return;
  clearTimeout(watchdog);
  watchdog = null;
}

function callSafely(action) {
  if (typeof action !== "function") return;
  try {
    action();
  } catch (error) {
    /* One job's mess is not the lane's to carry. */
  }
}

/* Everything waiting on an empty lane, told once. */
function drain() {
  if (isBusy() || !waiters.length) return;
  const held = waiters;
  waiters = [];
  held.forEach(callSafely);
}

/* Only the job whose turn it is can end that turn: a late done() from one
   already cancelled or timed out is nothing. */
function settle(token) {
  if (!current || current.token !== token) return;
  stopWatchdog();
  current = null;
  step();
}

function step() {
  if (current) return;
  const next = lane.shift();
  if (!next) {
    drain();
    return;
  }

  current = next;
  const finish = () => settle(next.token);
  if (next.timeoutMs) {
    watchdog = setTimeout(finish, next.timeoutMs + WATCHDOG_SLACK_MS);
  }
  try {
    next.run(finish);
  } catch (error) {
    finish();
  }
}

export function enqueue(job) {
  if (!job || typeof job.run !== "function") return;
  serial += 1;
  lane.push({
    token: serial,
    name: String(job.name || "job"),
    group: String(job.group || DEFAULT_GROUP),
    run: job.run,
    cancel: typeof job.cancel === "function" ? job.cancel : null,
    timeoutMs: Math.max(0, Number(job.timeoutMs) || 0),
  });
  step();
}

/* Runs now if the lane is empty, otherwise once it empties. */
export function whenIdle(action) {
  if (typeof action !== "function") return;
  if (!isBusy()) {
    callSafely(action);
    return;
  }
  waiters.push(action);
}

/* Drops what one group put on the lane — the job in progress included — and
   hands the screen back through each cancel. No group at all means everything,
   which is only what tearing a session down wants. */
export function clear(group) {
  const wanted = group == null ? ALL : String(group);
  const dropped = [];
  const kept = [];

  for (let i = 0; i < lane.length; i += 1) {
    const job = lane[i];
    if (wanted === ALL || job.group === wanted) dropped.push(job);
    else kept.push(job);
  }
  lane = kept;

  const running = current;
  const stopping =
    Boolean(running) && (wanted === ALL || running.group === wanted);
  if (stopping) {
    stopWatchdog();
    current = null;
  }
  /* Only a full clear forgets what was waiting on an empty lane: after a
     partial one there may still be something in front of it. */
  if (wanted === ALL) waiters = [];

  if (stopping && running.cancel) callSafely(running.cancel);
  for (let j = 0; j < dropped.length; j += 1) {
    if (dropped[j].cancel) callSafely(dropped[j].cancel);
  }

  if (stopping) step();
  else drain();
}
