/* Everything that makes noise, in one door: the music deck, the narrator's
   voice, and the cue clips. */

export * as music from "./music.js";
export * as narration from "./narration.js";
export * as sfx from "./sfx.js";

import * as music from "./music.js";
import * as narration from "./narration.js";
import * as sfx from "./sfx.js";

/* Everything off, and the held narration clips dropped. */
export function silence() {
  music.stopPlayer();
  narration.reset();
  sfx.stopAll();
}
