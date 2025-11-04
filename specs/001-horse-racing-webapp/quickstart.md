# Quickstart: Horse Racing Webapp MVP

## Prerequisites
- Node.js ≥ 20 (for Vitest/Playwright dev dependencies).
- Firebase CLI (`npm install -g firebase-tools`) for emulator + hosting preview.
- Google account with access to the `kooksun-hr` Firebase project (production credentials stored outside repo).

## Initial Setup
1. `cp .env.local.example .env.local` and fill:
   - `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL=https://kooksun-hr-default-rtdb.firebaseio.com/`, `FIREBASE_PROJECT_ID`, `SESSION_SECRET`.
2. Create `firebase-config.js` in the project root (gitignored) with:
   ```js
   window.__FIREBASE_CONFIG__ = {
     apiKey: import.meta.env?.VITE_FIREBASE_API_KEY ?? "todo-api-key",
     authDomain: "todo-project-id.firebaseapp.com",
     databaseURL: "https://kooksun-hr-default-rtdb.firebaseio.com/",
     projectId: "kooksun-hr",
     storageBucket: "todo-project-id.appspot.com",
     messagingSenderId: "todo-sender-id",
     appId: "todo-app-id",
   };
   window.__SESSION_SECRET__ = window.__SESSION_SECRET__ ?? "dev-session-secret";
   ```
   Include `<script src="./firebase-config.js"></script>` before `<script type="module" src="./app.js"></script>` in `index.html` so that configuration loads ahead of the app bundle.
3. Install dev dependencies: `npm install --save-dev firebase vitest playwright @playwright/test http-server`.
4. Bootstrap Firebase config:
   ```bash
   firebase use kooksun-hr
   firebase setup:emulators:database
   ```
5. Start emulators:
   ```bash
   firebase emulators:start --import=.firebase/emulator-data --export-on-exit
   ```

## Running the Host Experience
1. Serve static assets with no bundler:
   ```bash
   npx http-server . -o /index.html
   ```
2. Open `http://127.0.0.1:8080` in a modern browser.
3. Enter 2–10 unique player names separated by commas and click **Start Race**.
4. Observe console logs for lifecycle messages:
   - `session:init`, `countdown:t-5..0`, `tick:<n>` with distance + cheer boost details.
5. After the popup displays results, close the modal to trigger Firebase cleanup (`session:cleanup` log).

## Spectator Cheer Mode
1. Open a second browser (or incognito window) at the same URL while the host session is running.
2. Page detects existing Firebase session and presents cheer buttons per player.
3. Clicking a cheer button increments the player's cheer counter via Firebase transaction (logged as `cheer:update`).
4. Confirm host tab logs the boost the next tick and animation accelerates accordingly.

## Firebase Data Schema
- `sessions/{sessionId}`: Root session document containing `status`, `seed`, `tick`, `finishOrder`, and timestamps.
- `sessions/{sessionId}/players/{playerId}`: Player metadata with `name`, `laneIndex`, `distance`, `cheerCount`, and derived race stats.
- `sessions/{sessionId}/telemetry/{tick}` (optional): Per-tick diagnostic payload mirroring console telemetry.

## Security Rules Summary
- Reads: Any client may read an active session while `status !== "finished"` or until all players in `finishOrder`.
- Writes:
  - Host (authenticated by emulator auth/SESSION_SECRET) can create/update the session root, player distances, and status transitions.
  - Spectators increment `cheerCount` through Firebase `runTransaction`, ensuring monotonic increases and preventing overwrites.
  - Only the host can delete the session path during cleanup.
- Validation guards:
  - `status` limited to `pending`, `countdown`, `running`, `finished`.
  - `distance` values clamped to `[0, 1]` and non-decreasing.
  - `cheerCount` increments only and remains numeric.

## Testing & Telemetry
- Unit tests:
  ```bash
  npx vitest run
  ```
- Playwright smoke (requires emulator + http-server running):
  ```bash
  npx playwright test
  ```
- End-to-end test seeds deterministic RNG and asserts finish order for reproducibility.
- Review telemetry overlay (optional) or console logs for tick calculations; export logs to JSON if deeper analysis needed.

## Cleanup
- Closing the host tab or clicking **Reset** deletes `/sessions/{sessionId}` from Firebase and stops timers.
- Stop emulators with `Ctrl+C`; data automatically exported to `.firebase/emulator-data`.
