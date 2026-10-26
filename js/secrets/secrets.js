export const NARRATION_ENDPOINT = "https://fish-tts.segalyair11.workers.dev/"

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: [
      "turn:free.expressturn.com:3478",
      "turn:free.expressturn.com:3478?transport=tcp",
    ],
    username: "ef82J49N2V8R2P6Z2M",
    credential: "7m9D3K6V8Q5L4X2W",
  },
];