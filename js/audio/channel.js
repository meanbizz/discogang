/* One sound at a time. The cue channels and the narrator's voice both hold a
   single element they start, stop and rewind — this is that handling. */

export function rewind(audio) {
  if (!audio) return;
  try {
    audio.currentTime = 0;
  } catch (error) {
    /* not seekable yet */
  }
}

export function start(audio) {
  const started = audio.play();
  if (started && started.catch) started.catch(() => {});
  return started;
}

export function halt(audio) {
  if (!audio) return;
  try {
    audio.pause();
  } catch (error) {
    /* nothing to pause */
  }
  rewind(audio);
}
