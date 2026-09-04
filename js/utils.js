/* Shared helpers: room codes, field cleaning, thumbnails, inline markup,
   clipboard. Nothing here knows about the session. */

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

/* A portrait's address travels as a custom property, so the stylesheet can
   lay the frame down before the face. */
const PORTRAIT_VAR = "--portrait";

function cssUrl(href) {
  return `url("${href}")`;
}

export function sanitizeRoomCode(value) {
  const code = String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, ROOM_CODE_MAX);
  return code.length >= ROOM_CODE_MIN ? code : "";
}

export function randomRoomCode() {
  let out = "";
  const source = window.crypto;
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

export function cleanScene(raw) {
  if (!raw || typeof raw !== "object") return { image: null };
  return { image: cleanImageUrl(raw.image) };
}

export function cleanNpc(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    name,
    thumbnail: cleanImageUrl(raw.thumbnail),
  };
}

export function isAdminName(name) {
  return cleanName(name).toLowerCase() === ADMIN_NAME;
}

/* data-mark says whether the fallback is a real initial or a bare question
   mark, so only the latter is dimmed. */
export function paintThumb(element, person) {
  if (!element) return;
  const portrait = person && person.portrait ? person.portrait : null;

  if (portrait) {
    element.style.setProperty(PORTRAIT_VAR, cssUrl(portrait));
    element.removeAttribute("data-empty");
    element.removeAttribute("data-mark");
    element.textContent = "";
    return;
  }

  element.style.removeProperty(PORTRAIT_VAR);
  element.setAttribute("data-empty", "true");
  const initial = person && person.name ? person.name.charAt(0) : "";
  element.setAttribute("data-mark", initial ? "letter" : "unknown");
  element.textContent = initial || "?";
}

export function clearThumb(element) {
  if (!element) return;
  element.style.removeProperty(PORTRAIT_VAR);
  element.setAttribute("data-empty", "true");
  element.setAttribute("data-mark", "unknown");
  element.textContent = "";
}

/* "spoken" → quote, (aside) → aside, *style* → past. Text only: every piece
   lands through createTextNode/textContent. */
export function paintMarkup(target, text) {
  const source = String(text == null ? "" : text);
  const pattern = /"[^"]*"|\([^)]*\)|\*[^*]*\*/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > cursor) {
      target.appendChild(
        document.createTextNode(source.slice(cursor, match.index)),
      );
    }
    const head = match[0].charAt(0);
    const piece = document.createElement("span");
    piece.className =
      head === '"' ? "mark-quote" : head === "(" ? "mark-aside" : "mark-past";
    piece.textContent = match[0];
    target.appendChild(piece);
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) {
    target.appendChild(document.createTextNode(source.slice(cursor)));
  }
}

/* One of the markup pairs written at the end of a field, with the caret left
   between the two marks. Spacing follows the field, the way a named item does. */
export function appendPair(input, open, close) {
  if (!input) return;
  const body = String(input.value == null ? "" : input.value);
  const lead = !body || /\s$/.test(body) ? body : body + " ";
  const next = lead + open + close;
  if (input.maxLength > 0 && next.length > input.maxLength) return;

  input.value = next;
  const caret = next.length - close.length;
  input.focus();
  if (input.setSelectionRange) input.setSelectionRange(caret, caret);
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
