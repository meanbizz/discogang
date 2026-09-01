/* The one NetworkManager the session runs on, and the two ways to speak on
   it. handlers.js registers the callbacks at boot. */

import { NetworkManager } from "../network.js";

export const network = new NetworkManager({});

export function setHandlers(handlers) {
  network.handlers = handlers;
}

export function broadcast(payload, exceptPeerId) {
  network.broadcast(payload, exceptPeerId);
}

/* Returns whether the line went anywhere. */
export function sendUpstream(payload) {
  if (network.upstream && network.upstream.open) {
    network.upstream.send(payload);
    return true;
  }
  return false;
}
