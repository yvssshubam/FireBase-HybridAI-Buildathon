// Realtime "everything for my restaurant" listeners. Each collection keeps
// restaurantId on the document, so `where(restaurantId == uid)` satisfies the rules.
import { collection, onSnapshot, query, where, type Firestore } from "firebase/firestore";
import {
  parseAudit,
  parseDecision,
  parseHold,
  parseResolution,
  type AuditDoc,
  type DecisionDoc,
  type HoldDoc,
  type ResolutionDoc,
} from "./docs.ts";

export interface Watched<T> {
  byId: ReadonlyMap<string, T>;
  unreadable: string[];
}

export function watchByRestaurant<T>(
  db: Firestore,
  coll: string,
  restaurantId: string,
  parse: (id: string, data: unknown) => T,
  next: (w: Watched<T>) => void,
  fail: (e: unknown) => void,
): () => void {
  return onSnapshot(
    query(collection(db, coll), where("restaurantId", "==", restaurantId)),
    (snap) => {
      const byId = new Map<string, T>();
      const unreadable: string[] = [];
      for (const d of snap.docs) {
        try {
          byId.set(d.id, parse(d.id, d.data({ serverTimestamps: "estimate" })));
        } catch (e) {
          unreadable.push(e instanceof Error ? e.message : d.id);
        }
      }
      next({ byId, unreadable });
    },
    fail,
  );
}

export const COLLECTIONS = {
  decisions: { name: "decisions", parse: parseDecision },
  holds: { name: "holds", parse: parseHold },
  resolutions: { name: "resolutions", parse: parseResolution },
  audits: { name: "audits", parse: parseAudit },
} as const;

export type { AuditDoc, DecisionDoc, HoldDoc, ResolutionDoc };
