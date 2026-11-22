# FairClaim

**Fast refunds for honest customers. Proof for restaurants.**

FairClaim is a food-delivery refund-claim system built for the #BuildHybridAI 2026 hackathon (built Nov 22–30, 2026).
Evidence is verified **at the moment of capture, on the device** (Gemini Nano through Firebase AI Logic hybrid inference), and refunds are **proportionate to the damage and to the party responsible**, set by deterministic rules (never by the model).

> Demo: _Vercel URL — Phase 4_ · Android APK: _GitHub Releases — Phase 4_ · Video: _YouTube — Phase 4_

## The problem

Refund photos can now be faked with AI, and disputes are all-or-nothing: refund the whole order (the restaurant loses, fraud wins) or reject (the honest customer loses).
FairClaim makes fake evidence hard to create instead of trying to detect it later: a seal code links the packaging to the order, a random live challenge and an FFT moiré check stop pre-made or on-screen fakes, and App Check attests the genuine app.

## How it works

| Step | Where | Firebase AI Logic mode |
|---|---|---|
| Dispatch photo: items, seal intact, seal code | Restaurant web (Chrome) | `PREFER_ON_DEVICE` |
| Handoff snap: seal state before opening | Customer Android | `PREFER_ON_DEVICE` |
| Claim photo: code + live finger challenge | Customer Android | `PREFER_ON_DEVICE` |
| Tap crop: item, damage type, severity | Customer Android | `PREFER_ON_DEVICE` |
| Consistency review + explanations (EN / हिन्दी / தமிழ்) | Android / web, JSON only | `ONLY_IN_CLOUD` |
| Refund amount, liability split, holds | Deterministic engine (Kotlin on device, TS on web) | no AI |

Every model call goes through Firebase AI Logic (`firebase/ai` on web, `firebase-ai` + `firebase-ai-ondevice` on Android). There are no Gemini API keys in this repo.
Each screen shows the `inferenceSource` badge (`ON_DEVICE` / `IN_CLOUD`), and the cloud fallback runs the same checks on devices without Gemini Nano.

_Architecture diagram — Phase 4._

## Repository layout

```
apps/restaurant-web/      Vite + React + TS restaurant app (Phase 1)
apps/customer-android/    Kotlin + Compose customer app
  engine/                 Kotlin port of the decision engine (pure JVM)
  fft/                    FFT moiré "photo of a screen" detector (pure JVM)
packages/schemas/         JSON Schemas, policy, model-output parsing, shared test vectors
engine/                   TypeScript reference decision engine
rules-tests/              Firestore + Storage security-rules tests (emulator)
firestore.rules  storage.rules  storage.lifecycle.json  firebase.json  remoteconfig.template.json
eval/                     Evaluation dataset, method and results (Phase 4)
dev/                      Development-only mocks (never in production builds)
```

## Decision engine

AI gathers and checks evidence; rules decide money. The engine implements the verification gate, the liability matrix (dispatch seal vs handoff seal for missing/wrong items; dispatch condition for spills), proportionate refunds (`price × severity`), the instant-refund cap and claim-history limit, and confidence-weighted holds.
The TypeScript and Kotlin engines are tested against **one** shared set of vectors in [`packages/schemas/test-vectors`](packages/schemas/test-vectors/README.md), which also documents every rule decision beyond the plan's text.

## Running the tests

Requirements: Node 24, JDK 21 (for the emulator and Gradle).

```bash
npm ci
npm run ci            # generated files up to date, lint, typecheck, TS engine + schema + web unit tests
npm run test:kotlin   # Kotlin engine + FFT against the same vectors
npm run test:rules    # Firestore + Storage rules on the emulator
npm run audit:prod
npm run build && npm run check:dist   # web build (needs the VITE_* env vars) + scan for debug tokens/dev code
```

## Restaurant web app (`apps/restaurant-web`)

Vite + React + TypeScript. Every model call goes through `firebase/ai` (Firebase AI Logic):
`DispatchCheck` uses `PREFER_ON_DEVICE` (Gemini Nano in Chrome, cloud fallback `gemini-3.5-flash-lite`) with structured
output on both paths; an invalid answer gets one retry with an `ONLY_IN_CLOUD` model, then the staff are asked for a retake.

```bash
cp apps/restaurant-web/.env.example apps/restaurant-web/.env.local   # fill in your Firebase web config
npm run dev:web                                                      # http://localhost:5173
```

- App Check: reCAPTCHA Enterprise in production; in `npm run dev:web` the App Check debug token is used (dev builds only; a
  production build fails if `VITE_APPCHECK_DEBUG_TOKEN` is set).
- Emulator mode: `VITE_USE_EMULATORS=true` + `npm run emulators`; see [`dev/README.md`](dev/README.md) for the customer simulator.
- `/terms` and `/privacy` are static pages (`terms.html`, `privacy.html`), served by Vercel with `cleanUrls`.

## Setup

1. `npm run gen` regenerates validators, vectors and `remoteconfig.template.json` from `packages/schemas`.
2. `firebase deploy --only firestore:rules,storage,remoteconfig` deploys rules and the policy.
3. `npm run seed:policy -- <project-id>` mirrors the policy into Firestore `config/policy` for the rules.
4. `gsutil lifecycle set storage.lifecycle.json gs://<bucket>` deletes crops and counter photos after 3 days.
5. `gsutil cors set storage.cors.json gs://<bucket>` (after putting your Vercel domain in it) lets the restaurant app download
   crops for the replay audit.

## Production note

For the hackathon, adjudication runs client-side (the customer's app writes the decision), protected by App Check, bounded by security rules (create-once, cap, totals, seal-code match) and re-checked by the restaurant app's replay audit. In production the final refund decision moves server-side.

## Privacy

On a Gemini-Nano device the full claim photo never leaves the phone: only the tapped crop and JSON are uploaded. On the cloud fallback the frame is sent to the Gemini API through Firebase AI Logic for that check only, and FairClaim does not store it. Crops are deleted after 3 days. Details: `/privacy` on the web app.

## License

[Apache-2.0](LICENSE)
