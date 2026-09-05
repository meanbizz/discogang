/* Everything that makes noise, in one door: the music deck, the narrator's
   voice, the cue clips, and the dial all three read their level off. */

export * as music from "./music.js";
export * as narration from "./narration.js";
export * as sfx from "./sfx.js";
export * as volume from "./volume.js";

import * as music from "./music.js";
import * as narration from "./narration.js";
import * as sfx from "./sfx.js";

/* Everything off, and the held narration clips dropped. */
export function silence() {
  music.stopPlayer();
  narration.reset();
  sfx.stopAll();
}
