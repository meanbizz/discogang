/* Portrait and thumbnail uploads: the size and type gate, the image host, and
   a probe for pasted addresses. */

import { IMAGE_HOST, IMAGE_TYPES, IMAGE_MAX_BYTES } from "./config.js";
import { cleanImageUrl } from "./utils.js";

export function uploadConfigured() {
  return Boolean(IMAGE_HOST.cloudName && IMAGE_HOST.uploadPreset);
}

/* Returns the reason to refuse, or "" when the file is fine. */
export function rejectImageFile(file) {
  if (!IMAGE_TYPES.includes(file.type)) {
    return "Use a PNG, JPEG, WebP or GIF image.";
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return "That image is larger than 5 MB.";
  }
  if (!uploadConfigured()) {
    return "No image host is configured. Paste an image address instead.";
  }
  return "";
}

export function uploadImage(file, done) {
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(IMAGE_HOST.cloudName)}/image/upload`;
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", IMAGE_HOST.uploadPreset);

  fetch(endpoint, { method: "POST", mode: "cors", body })
    .then((response) => {
      if (!response.ok) throw new Error("upload rejected");
      return response.json();
    })
    .then((data) => {
      const url = cleanImageUrl(data && data.secure_url);
      if (!url) throw new Error("no usable address returned");
      done(url, null);
    })
    .catch(() => {
      done(null, "The image host refused that upload.");
    });
}

export function probeImage(url, done) {
  const probe = new Image();
  probe.referrerPolicy = "no-referrer";
  probe.onload = () => done(true);
  probe.onerror = () => done(false);
  probe.src = url;
}
