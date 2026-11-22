// Claims behind the restaurant's decisions. The rules don't let a restaurant *list*
// claims (the read rule looks up the order), so each one is fetched by id, once.
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { parseClaim, type ClaimDoc } from "../data/docs.ts";

export interface ClaimsState {
  claims: ReadonlyMap<string, ClaimDoc>;
  /** claimId → why it isn't available ("deleted by the customer", parse error, …). */
  unavailable: ReadonlyMap<string, string>;
}

const CONCURRENCY = 4;
const code = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : "");

async function fetchClaim(db: Firestore, id: string): Promise<ClaimDoc | string> {
  try {
    const snap = await getDoc(doc(db, "claims", id));
    if (!snap.exists()) return "deleted by the customer";
    return parseClaim(snap.id, snap.data());
  } catch (e) {
    // A deleted claim reads as permission-denied (the read rule needs resource.data).
    if (code(e) === "permission-denied") return "deleted by the customer";
    return e instanceof Error ? e.message : String(e);
  }
}

export function useClaims(db: Firestore, claimIds: readonly string[]): ClaimsState {
  const [state, setState] = useState<ClaimsState>({ claims: new Map(), unavailable: new Map() });
  const requested = useRef(new Set<string>());
  const key = [...claimIds].sort().join(",");

  useEffect(() => {
    const todo = key === "" ? [] : key.split(",").filter((id) => !requested.current.has(id));
    if (todo.length === 0) return;
    for (const id of todo) requested.current.add(id);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        if (id === undefined) return;
        const r = await fetchClaim(db, id);
        setState((s) => {
          if (typeof r === "string") return { claims: s.claims, unavailable: new Map(s.unavailable).set(id, r) };
          return { claims: new Map(s.claims).set(id, r), unavailable: s.unavailable };
        });
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  }, [db, key]);

  return state;
}
