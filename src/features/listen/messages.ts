import type { ListenErrorCode, PausedReason } from "./listen-controller";

/** What went wrong, and what the user can do about it. */
export const LISTEN_ERRORS: Record<ListenErrorCode, { title: string; body: string }> = {
  "insecure-context": {
    title: "A secure connection is needed",
    body: "Browsers only allow microphone access on https:// pages (or localhost during development). Open SoundMatch over https and try again.",
  },
  unsupported: {
    title: "This browser can't analyse live audio",
    body: "Please use a current version of Chrome, Edge, Firefox or Safari.",
  },
  "permission-denied": {
    title: "Microphone access is blocked",
    body: "Allow the microphone for this site in your browser's settings (usually the icon next to the address bar), then press Start listening again.",
  },
  "no-microphone": {
    title: "No microphone found",
    body: "Connect a microphone or check that your device's microphone is turned on. If you chose a specific input, try “Default microphone”.",
  },
  "device-in-use": {
    title: "The microphone is busy",
    body: "Another app or browser tab may be using it, or your system blocked access. Close the other app and try again.",
  },
  "device-lost": {
    title: "The microphone was disconnected",
    body: "Reconnect it, or choose another input below, then press Start listening.",
  },
  "audio-start-failed": {
    title: "Audio couldn't start",
    body: "Something went wrong starting the browser's audio system. Reload the page and try again.",
  },
  "engine-failed": {
    title: "The analysis engine stopped",
    body: "Reload the page to start it again. Your microphone has been turned off.",
  },
};

export const PAUSED_MESSAGES: Record<PausedReason, { title: string; body: string; action: string }> = {
  hidden: {
    title: "Listening paused",
    body: "You switched to another tab or app, so the microphone was turned off.",
    action: "Start listening again",
  },
  interrupted: {
    title: "Audio was interrupted",
    body: "Your device paused audio (for example for a call or the screen locking).",
    action: "Resume listening",
  },
};
