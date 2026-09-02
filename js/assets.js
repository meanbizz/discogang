/* js/assets.js */

/* Every picture and sound the session can reach for, pulled into memory at
   boot so nothing is fetched at the moment it is needed. */

import * as sfx from "./audio/sfx.js";
import { skillArtUrls } from "./dialogue/skills.js";

const held = [];
let done = false;

const IMAGES = [
  "images/portrait-frame.png",
  "images/panel-bg.png",
  "images/check-success-background.png",
  "images/check-failure-background.png",
  "images/check-success-title.svg",
  "images/check-failure-title.svg",
  /* The plate a new skill point announces itself with. */
  "images/new_skillpoint.png",
];

/* Keeping the reference is what keeps the decode around. */
export function holdImage(src) {
  if (!src) return;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  held.push(image);
}

export function preloadAll() {
  if (done) return;
  done = true;

  sfx.preloadAll();

  const local = IMAGES.slice();
  for (let i = 1; i <= 6; i += 1) local.push("images/dice/" + i + ".svg");
  local.forEach((src) => holdImage(new URL(src, window.location.href).href));

  skillArtUrls().forEach(holdImage);
}
