/* A save going to disk and coming back. The only DOM here is the throwaway
   anchor a download needs. */

import { parse } from "./session.js";

/* A full history of rounds is the bulk of a save, and each payload is allowed
   200k characters of its own. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes())
  );
}

export function fileName(snap) {
  const room = snap && snap.room ? snap.room : "session";
  return "salon-" + room + "-" + stamp() + ".json";
}

/* Returns whether the browser took the download. */
export function download(snap) {
  let url = null;
  try {
    const body = JSON.stringify(snap, null, 2);
    const blob = new Blob([body], { type: "application/json" });
    url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(snap);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    /* The click is asynchronous; the address has to outlive this tick. */
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}

/* done(session, error) — one argument is always null. */
export function readFile(file, done) {
  if (!file) {
    done(null, "No file was chosen.");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    done(null, "That save is too large to read.");
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => done(null, "That file could not be read.");
  reader.onload = () => {
    const attempt = parse(String(reader.result));
    done(attempt.session, attempt.error);
  };
  reader.readAsText(file);
}
