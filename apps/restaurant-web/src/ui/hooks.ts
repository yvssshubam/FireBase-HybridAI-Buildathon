import { useEffect, useState, useSyncExternalStore } from "react";
import { deviceModelStore, refreshDeviceModel } from "../ai/deviceModel.ts";
import { friendlyError } from "../errors.ts";

export type Loadable<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: T };

type Subscribe<T> = (next: (v: T) => void, fail: (e: unknown) => void) => () => void;

/** Realtime listener as state. `subscribe` must be memoised (useCallback). */
export function useWatch<T>(subscribe: Subscribe<T>): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ kind: "loading" });
  useEffect(
    () =>
      subscribe(
        (value) => setState({ kind: "ready", value }),
        (e) => setState({ kind: "error", message: friendlyError(e) }),
      ),
    [subscribe],
  );
  return state;
}

/** Wall clock, refreshed every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

let deviceChecked = false;
export function useDeviceModel() {
  useEffect(() => {
    if (!deviceChecked) {
      deviceChecked = true;
      void refreshDeviceModel();
    }
  }, []);
  return useSyncExternalStore(deviceModelStore.subscribe, deviceModelStore.get);
}
