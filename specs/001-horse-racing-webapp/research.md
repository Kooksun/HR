# Research: Horse Racing Webapp MVP

## Seedable RNG without Bundler
- **Decision**: Implement a lightweight linear congruential generator (LCG) in `app.js` and expose `createRng(seed)` for deterministic tick distances.
- **Rationale**: An inline LCG keeps bundle size minimal, works in browsers without external dependencies, and is trivial to reset per race or spectator test case.
- **Alternatives considered**: `seedrandom` CDN build (adds 6 KB compressed and external script tag); crypto-based RNG (`crypto.getRandomValues`) lacks deterministic seeding; Math.random lacks reproducibility.

## Bundler-Free Testing Stack
- **Decision**: Use Vitest with `jsdom` via Node ESM to import `app.js` modules, and run Playwright against the static files served by `npx http-server`.
- **Rationale**: Vitest provides fast unit testing in Node while supporting native ES modules; Playwright can launch Chromium to validate animations and Firebase mocks; both operate as dev-only npm scripts without altering production assets.
- **Alternatives considered**: Jest (heavier CommonJS shim, requires Babel); Cypress (excellent e2e but harder to script keyboard coverage without frontend bundler); Manual testing (insufficient coverage and violates constitution).

## Tick Scheduling without Animation Jank
- **Decision**: Use `requestAnimationFrame` loop that accumulates elapsed time and triggers a race tick whenever ≥1000 ms, preserving UI smoothness while respecting the 1 s cadence.
- **Rationale**: `requestAnimationFrame` aligns updates with repaint cycles, avoiding drift that `setInterval` can incur on throttled tabs; time accumulation keeps tick frequency consistent even if frames drop.
- **Alternatives considered**: `setInterval(1000)` (simple but susceptible to drift and tab throttling); `setTimeout` recursion (same limitations); Web Workers (overkill for 10 participants).

## Firebase Cheer Counter & Emulator Strategy
- **Decision**: Store session data at `/sessions/{sessionId}` with `players/{playerId}` nodes containing `cheerCount` integers; enforce increments via `runTransaction` on the host and `update` operations for spectators; mirror rules in `database.rules.json` and use Firebase Emulator Suite during development.
- **Rationale**: Transaction-based updates avoid race conditions between concurrent cheerers; a well-defined schema supports cleanup logic and spectator-mode discovery; emulators keep local testing isolated from production data.
- **Alternatives considered**: Cloud Functions intermediary (adds latency and operational overhead); Firestore (powerful querying but unnecessary for simple counters); direct `set` writes (risk overwriting concurrent updates).
