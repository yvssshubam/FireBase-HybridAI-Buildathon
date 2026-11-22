// Boot: config → Firebase (App Check first) → anonymous sign-in + policy →
// Terms gate → sandbox restaurant → main screen.
import type { User } from "firebase/auth";
import { useEffect, useState, type ReactNode } from "react";
import { readConfig, type ConfigResult } from "../firebase/config.ts";
import { initServices, type Services } from "../firebase/app.ts";
import { ensureSignedIn } from "../firebase/auth.ts";
import { loadPolicy, type LoadedPolicy } from "../firebase/policy.ts";
import type { RestaurantDoc } from "../data/docs.ts";
import { acceptTerms, createRestaurant, getRestaurant, hasAcceptedTerms } from "../data/session.ts";
import { friendlyError } from "../errors.ts";
import { TERMS_VERSION } from "../legal.ts";
import { Notice, Spinner } from "./common.tsx";
import { Main } from "./Main.tsx";

type Phase =
  | { kind: "booting" }
  | { kind: "failed"; message: string }
  | { kind: "terms"; services: Services; user: User; policy: LoadedPolicy; saving: boolean; error: string | null }
  | { kind: "restaurant"; services: Services; user: User; policy: LoadedPolicy }
  | { kind: "ready"; services: Services; user: User; policy: LoadedPolicy; restaurant: RestaurantDoc };

// Name each variable: passing the whole import.meta.env object would make Vite inline
// every VITE_* line from .env files into the bundle, used or not.
const config: ConfigResult = readConfig(
  {
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
    VITE_USE_EMULATORS: import.meta.env.DEV ? import.meta.env.VITE_USE_EMULATORS : undefined,
  },
  import.meta.env.DEV,
);

export function App() {
  return (
    <div className="app">
      {config.ok ? (
        <Session />
      ) : (
        <>
          <MissingConfig missing={config.missing} />
          <Footer />
        </>
      )}
    </div>
  );
}

function Session() {
  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!config.ok) return;
    let live = true;
    (async () => {
      const services = initServices(config.config);
      const [user, policy] = await Promise.all([ensureSignedIn(services.auth), loadPolicy(services.remoteConfig)]);
      if (!(await hasAcceptedTerms(services.db, user.uid))) {
        if (live) setPhase({ kind: "terms", services, user, policy, saving: false, error: null });
        return;
      }
      if (live) setPhase({ kind: "restaurant", services, user, policy });
    })().catch((e: unknown) => live && setPhase({ kind: "failed", message: friendlyError(e) }));
    return () => {
      live = false;
    };
  }, [attempt]);

  const restaurantPhase = phase.kind === "restaurant" ? phase : null;
  useEffect(() => {
    if (!restaurantPhase) return;
    let live = true;
    const { services, user } = restaurantPhase;
    (async () => (await getRestaurant(services.db, user.uid)) ?? (await createRestaurant(services.db, user.uid)))().then(
      (restaurant) => live && setPhase({ ...restaurantPhase, kind: "ready", restaurant }),
      (e: unknown) => live && setPhase({ kind: "failed", message: friendlyError(e) }),
    );
    return () => {
      live = false;
    };
  }, [restaurantPhase]);

  async function accept() {
    if (phase.kind !== "terms") return;
    setPhase({ ...phase, saving: true, error: null });
    try {
      await acceptTerms(phase.services.db, phase.user.uid);
      setPhase({ kind: "restaurant", services: phase.services, user: phase.user, policy: phase.policy });
    } catch (e) {
      setPhase({ ...phase, saving: false, error: friendlyError(e) });
    }
  }

  if (phase.kind === "ready") {
    return <Main services={phase.services} uid={phase.user.uid} restaurant={phase.restaurant} policy={phase.policy} />;
  }
  return (
    <>
      <SessionScreen phase={phase} onRetry={() => { setPhase({ kind: "booting" }); setAttempt((a) => a + 1); }} onAccept={() => void accept()} />
      <Footer />
    </>
  );
}

function SessionScreen({ phase, onRetry, onAccept }: { phase: Exclude<Phase, { kind: "ready" }>; onRetry: () => void; onAccept: () => void }) {
  switch (phase.kind) {
    case "booting":
      return <Booting />;
    case "failed":
      return (
        <Centered>
          <Notice tone="error" title="FairClaim couldn't start">
            {phase.message}
          </Notice>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        </Centered>
      );
    case "terms":
      return <TermsGate saving={phase.saving} error={phase.error} onAccept={onAccept} />;
    case "restaurant":
      return <Centered><Spinner label="Setting up your demo restaurant…" /></Centered>;
  }
}

function Booting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <Centered>
      <Spinner label="Connecting to Firebase…" />
      {slow && (
        <p className="muted small">
          Still connecting. If this doesn't finish, check the network, and allow google.com and gstatic.com (reCAPTCHA) in any ad or script blocker.
        </p>
      )}
    </Centered>
  );
}

function TermsGate({ saving, error, onAccept }: { saving: boolean; error: string | null; onAccept: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Centered>
      <section className="gate" aria-labelledby="gate-title">
        <h1 id="gate-title">FairClaim for restaurants</h1>
        <p>
          This is a hackathon prototype. Refunds, holds and liability are simulated: no real money moves. Photos are checked by Gemini, on this computer when
          Chrome's built-in model is available and otherwise in the cloud.
        </p>
        <ul>
          <li>For people aged 18 and over.</li>
          <li>Don't photograph people or use other people's data.</li>
          <li>AI checks can be wrong. Fixed rules, not the AI, set every amount.</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            I am 18 or older and agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener">
              Terms
            </a>{" "}
            and the{" "}
            <a href="/privacy" target="_blank" rel="noopener">
              Privacy Policy
            </a>{" "}
            (version {TERMS_VERSION}).
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="button" className="btn btn-primary" disabled={!checked || saving} onClick={onAccept}>
          {saving ? "Saving…" : "Agree and continue"}
        </button>
      </section>
    </Centered>
  );
}

function MissingConfig({ missing }: { missing: string[] }) {
  return (
    <Centered>
      <Notice tone="error" title="Firebase isn't configured">
        This build has no Firebase web config. Set these environment variables (Vercel → Project → Settings → Environment Variables, or
        apps/restaurant-web/.env.local) and rebuild:
        <ul className="small">
          {missing.map((m) => (
            <li key={m}>
              <code>{m}</code>
            </li>
          ))}
        </ul>
      </Notice>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="centered">{children}</div>;
}

function Footer() {
  return (
    <footer className="footer">
      <span>Prototype: all money shown is simulated.</span>
      <nav aria-label="Legal">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </footer>
  );
}
