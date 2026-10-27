/* Signed-up TURN credentials, fetched once and folded into ICE_SERVERS before any peer is built. */

import { ICE_SERVERS } from "./config.js";
import * as secrets from "./secrets/secrets.js";

const WAIT_MS = 4000;
let pending = null;

function adopt(list) {
  list.forEach((entry) => {
    if (!entry || !entry.urls) return;
    const key = JSON.stringify(entry.urls);
    if (ICE_SERVERS.some((held) => JSON.stringify(held.urls) === key)) return;
    const server = { urls: entry.urls };
    if (entry.username) server.username = entry.username;
    if (entry.credential) server.credential = entry.credential;
    ICE_SERVERS.push(server);
  });
}

/* Resolves true once credentials are in, false when none are configured or the host did not answer. */
export function loadTurn() {
  if (pending) return pending;
  const url =
    typeof secrets.TURN_CREDENTIALS_URL === "string"
      ? secrets.TURN_CREDENTIALS_URL.trim()
      : "";
  if (!url) {
    pending = Promise.resolve(false);
    return pending;
  }

  const fetched = fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));

  pending = Promise.race([fetched, timeout]).then((data) => {
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.iceServers)) list = data.iceServers;
    else if (data && data.iceServers && data.iceServers.urls) list = [data.iceServers];
    if (!list || !list.length) {
      pending = null;
      return false;
    }
    adopt(list);
    return true;
  });
  return pending;
}
