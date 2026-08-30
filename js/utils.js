import {
  ROOM_CODE_MIN,
  ROOM_CODE_MAX,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  MAX_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  IMAGE_URL_MAX_CHARS,
  ADMIN_NAME,
} from "./config.js";

export function sanitizeRoomCode(value) {
  const code = String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, ROOM_CODE_MAX);
  return code.length >= ROOM_CODE_MIN ? code : "";
}

export function randomRoomCode() {
  let out = "";
  const source = window.crypto || window.msCrypto;
  if (source && source.getRandomValues) {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    source.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i += 1) {
      out += ROOM_CODE_ALPHABET.charAt(bytes[i] % ROOM_CODE_ALPHABET.length);
    }
    return out;
  }
  for (let j = 0; j < ROOM_CODE_LENGTH; j += 1) {
    out += ROOM_CODE_ALPHABET.charAt(
      Math.floor(Math.random() * ROOM_CODE_ALPHABET.length),
    );
  }
  return out;
}

export function roomFromHash() {
  const raw = location.hash.slice(1);
  if (!raw) return "";
  try {
    return sanitizeRoomCode(decodeURIComponent(raw));
  } catch (error) {
    return "";
  }
}

export function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function cleanName(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

export function cleanText(value) {
  return String(value == null ? "" : value)
    .slice(0, MAX_MESSAGE_LENGTH)
    .trim();
}

export function cleanImageUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > IMAGE_URL_MAX_CHARS) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return null;

  const href = parsed.href;
  if (/["'\\\s]/.test(href)) return null;
  return href;
}

export function cssUrl(href) {
  return `url("${href}")`;
}

export function cleanScene(raw) {
  if (!raw || typeof raw !== "object") return { image: null };
  return { image: cleanImageUrl(raw.image) };
}

export function isAdminName(name) {
  return cleanName(name).toLowerCase() === ADMIN_NAME;
}

export function paintThumb(element, person) {
  if (!element) return;
  element.style.backgroundImage =
    person && person.portrait ? cssUrl(person.portrait) : "";
  if (person && person.portrait) {
    element.removeAttribute("data-empty");
    element.textContent = "";
  } else {
    element.setAttribute("data-empty", "true");
    element.textContent = person && person.name ? person.name.charAt(0) : "";
  }
}

export function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => done(true),
      () => done(copyByCarrier(text)),
    );
    return;
  }
  done(copyByCarrier(text));
}

function copyByCarrier(text) {
  const carrier = document.createElement("textarea");
  carrier.value = text;
  carrier.setAttribute("readonly", "readonly");
  carrier.style.position = "fixed";
  carrier.style.top = "-1000px";
  carrier.style.opacity = "0";
  document.body.appendChild(carrier);

  const restore = document.activeElement;
  let ok = false;
  try {
    carrier.select();
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  carrier.remove();
  if (restore && restore.focus) restore.focus();
  return ok;
}
