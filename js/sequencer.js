/* js/sequencer.js */

/* One lane for everything that takes the screen: the dice tape, the check
   verdict, the experience plate. Jobs run one at a time, in the order they
   were asked for, so a node that rolls and then hands over experience shows
   the dice first and the words after — and nothing has to add up durations to
   arrange that. Retiming a beat in js/timing.js can no longer put two of them
   on screen at once.

   A job is { name, run, cancel, timeoutMs }:

     run(done)   called when the lane is free. Whatever it put on screen, it
                 calls done() once that has left again.
     cancel()    the job was dropped — queued or mid-turn — because the round
                 ended or the seat left. Put the screen back.
     timeoutMs   how long the job expects to need. The watchdog is set a
                 little past it, so a done() that never arrives (a dropped
                 animationend, a tab hidden mid-fade) cannot close the lane
                 for the rest of the session.

   whenIdle is for the small movements not worth a turn of their own — a
   vitals bar flashing — which should still not happen underneath the dice.

   No DOM, no durations of its own, and nothing here knows what a check is. */

const WATCHDOG_SLACK_MS = 1200;

let lane = [];
let current = null;
let watchdog = null;
let waiters = [];
let serial = 0;

export function isBusy() {
  return Boolean(current) || lane.length > 0;
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
    run: job.run,
    cancel: typeof job.cancel === "function" ? job.cancel : null,
    timeoutMs: Math.max(0, Number(job.timeoutMs) || 0),
  });
  step();
}

/* Runs now if the lane is empty, otherwise once it empties. Dropped along
   with everything else by clear: a flash nobody saw is not worth chasing. */
export function whenIdle(action) {
  if (typeof action !== "function") return;
  if (!isBusy()) {
    callSafely(action);
    return;
  }
  waiters.push(action);
}

/* The scene these jobs belonged to is over. Everything queued is cancelled,
   the one in progress included, and the screen is handed back. */
export function clear() {
  const running = current;
  const queued = lane;
  lane = [];
  current = null;
  waiters = [];
  stopWatchdog();

  if (running && running.cancel) callSafely(running.cancel);
  queued.forEach((job) => {
    if (job.cancel) callSafely(job.cancel);
  });
}
