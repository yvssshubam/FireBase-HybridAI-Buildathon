// Typed reads of Firestore data. Documents are written by other clients (the Android
// app), so every field is checked before it reaches the engine or the UI.
import { Timestamp } from "firebase/firestore";

export class DocError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

export type Obj = Record<string, unknown>;

export function asObj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new DocError(path, "expected an object");
  return v as Obj;
}

export function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new DocError(`${path}.${key}`, "expected a string");
  return v;
}

export function strOrNull(o: Obj, key: string, path: string): string | null {
  return o[key] === null || o[key] === undefined ? null : str(o, key, path);
}

export function int(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new DocError(`${path}.${key}`, "expected an integer");
  return v;
}

export function intOrNull(o: Obj, key: string, path: string): number | null {
  return o[key] === null || o[key] === undefined ? null : int(o, key, path);
}

export function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new DocError(`${path}.${key}`, "expected a number");
  return v;
}

export function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new DocError(`${path}.${key}`, "expected a boolean");
  return v;
}

export function strList(o: Obj, key: string, path: string): string[] {
  const v = o[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new DocError(`${path}.${key}`, "expected a list of strings");
  return v as string[];
}

export function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], path: string): T {
  const v = str(o, key, path);
  if (!(allowed as readonly string[]).includes(v)) throw new DocError(`${path}.${key}`, `unexpected value "${v}"`);
  return v as T;
}

/**
 * Server timestamp in whole ms, computed exactly like the rules' toMillis(). Not
 * Math.floor(ts.toMillis()): that float can round up past the integer (e.g. nanos
 * 999_999_000 → +1 ms at today's epoch values).
 */
export function millisOrNull(o: Obj, key: string, path: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return v.seconds * 1000 + Math.floor(v.nanoseconds / 1_000_000);
  throw new DocError(`${path}.${key}`, "expected a timestamp");
}
