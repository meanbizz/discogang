/* Text arriving from a peer: field trimming and the HTML-to-text flattening
   dialogue bodies go through. */

export function own(map, key) {
  return (
    map &&
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(map, key)
  );
}

export function pick(map, key) {
  return own(map, key) ? map[key] : null;
}

export function line(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeKey(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(value) {
  return value.replace(/&(#\d{1,7}|[a-z]{2,8});/gi, (match, name) => {
    if (name.charAt(0) === "#") {
      const code = Number(name.slice(1));
      if (code > 0 && code < 0x110000) {
        try {
          return String.fromCodePoint(code);
        } catch (error) {
          return match;
        }
      }
      return match;
    }
    const key = name.toLowerCase();
    return own(ENTITIES, key) ? ENTITIES[key] : match;
  });
}

/* Bodies arrive as HTML or text. Tags flatten to newlines and are dropped;
   the result is only ever written with textContent. */
export function bodyText(value, max) {
  if (typeof value !== "string") return "";
  const flattened = value
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(flattened)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
