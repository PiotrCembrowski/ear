"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { SessionSnapshot } from "@/lib/audio-engine/listening-session";
import { ListenController, type ListenState } from "./listen-controller";

/** One controller per mounted Listen screen; released (mic off, worker ended) on unmount. */
export function useListenController(defaults: { sensitivityDb: number; a4Hz: number }): ListenController {
  const [controller] = useState(() => new ListenController(defaults));
  useEffect(() => controller.attach(), [controller]);
  return controller;
}

export function useListenState(controller: ListenController): ListenState {
  return useSyncExternalStore(controller.state.subscribe, controller.state.get, controller.state.get);
}

export function useLiveSnapshot(controller: ListenController): SessionSnapshot | null {
  return useSyncExternalStore(controller.live.subscribe, controller.live.get, () => null);
}
