# dev/

Development-only tools. Nothing in this folder is imported by `apps/*` production builds
(`apps/restaurant-web` never references `dev/`, and the build output is grepped for it).

## `customer-sim.ts`: play the customer against the emulators

Lets you test the restaurant web app's flows (orders, dispatch, claims tabs, holds,
counter-evidence, replay audit) before the Android app exists. It signs in as a test
customer on the **Auth emulator** and writes through the real security rules.

```powershell
# Terminal 1: emulators (project demo-fairclaim; needs JDK 21)
npm run emulators

# Terminal 2: policy mirror the rules read, then the web app in emulator mode
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; node scripts/seed-policy.mjs demo-fairclaim
# apps/restaurant-web/.env.local must contain VITE_USE_EMULATORS=true (+ your real Firebase config for AI Logic)
npm run dev:web

# Terminal 3: customer actions (pair code from the web app's header)
npm run dev:customer -- order ABC234                 # default: Chicken Biryani + Gulab Jamun
npm run dev:customer -- order ABC234 raita butter-naan  # pick menu ids
# dispatch the order in the web app, then:
npm run dev:customer -- claim <orderId> damaged      # handoff snap + damage claim (auto refund with a clean dispatch photo)
npm run dev:customer -- claim <orderId> nohandoff    # damage claim without a handoff snap → hold (try Accept / counter-evidence)
npm run dev:customer -- claim <orderId> missing      # missing-item claim, no crop
npm run dev:customer -- claim <orderId> unverified   # wrong finger count → Needs review
npm run dev:customer -- claim <orderId> tampered     # liability shifted to the restaurant → "Decision mismatch"
```

One claim per order; the rules also allow only one claim per 30 s and 5 per UTC day per
customer (the script waits out the 30 s). Restart the emulators to reset everything.

Notes:
- In emulator mode the web app keeps using your **real** project for AI Logic, App Check
  and Remote Config (there is no AI emulator), so the App Check debug token must be registered.
- The crop the script uploads is random bytes with a JPEG header, so the web app shows a
  broken image for it; the hash check still runs on those bytes.
- Storage emulator downloads from the browser need no CORS setup; the real bucket does
  (see `storage.cors.json`).
