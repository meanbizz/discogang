/* The one NetworkManager the session runs on, and the two ways to speak on
   it. handlers.js registers the callbacks at boot. */

import { NetworkManager } from "../network.js";
import { isAdminName } from "../utils.js";

/* isAdminName is handed over rather than imported inside the manager: the
   manager seats the host itself when it reclaims a room, and that is the one
   piece of naming it needs. */
export const network = new NetworkManager({ isAdminName });

export function setHandlers(handlers) {
  network.handlers = Object.assign({ isAdminName }, handlers);
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
