# Data Model: Horse Racing Webapp MVP

## Session
- **Path**: `/sessions/{sessionId}`
- **Fields**:
  - `sessionId: string` – UUID or timestamp-based identifier, matches host tab.
  - `status: "pending" | "countdown" | "running" | "finished"` – lifecycle guard.
  - `createdAt: string (ISO8601)` – host start timestamp.
  - `seed: number` – deterministic RNG seed shared across clients.
  - `tick: number` – current tick counter (increments each second).
  - `finishOrder: string[]` – ordered list of playerIds when race ends.
- **Validation**:
  - `status` transitions occur: `pending → countdown → running → finished`.
  - `finishOrder.length === playerCount` only when `status === "finished"`.
  - `seed` is immutable post-creation.
- **Relationships**:
  - Has many `Player` nodes at `/sessions/{sessionId}/players/{playerId}`.
  - Hosts optional telemetry under `/sessions/{sessionId}/telemetry/{tick}` for replay.

## Player
- **Path**: `/sessions/{sessionId}/players/{playerId}`
- **Fields**:
  - `playerId: string` – slugified name.
  - `name: string` – unique display label (2–20 chars).
  - `laneIndex: number` – integer starting at 0, ascending top-to-bottom.
  - `distance: number` – cumulative progress (0.0–1.0 normalized).
  - `cheerCount: number` – integer ≥0 incremented by spectators.
  - `lastCheerAt: string (ISO8601)` – optional timestamp for cooldown.
  - `finishTime: number | null` – milliseconds from race start; null until finished.
  - `rank: number | null` – 1-based final placement once known.
- **Validation**:
  - `distance` monotonically increases until capped at 1.0.
  - `cheerCount` can only increment by 1 per spectator action.
  - `rank` and `finishTime` set exactly once when the horse finishes.

## CheerEvent (Derived Telemetry)
- **Source**: Not stored as permanent nodes; emitted in telemetry logs and console output.
- **Shape**:
  - `{ tick: number, playerId: string, baseStep: number, cheerBoost: number, totalStep: number, cheerCount: number }`
- **Usage**: Reconstruct per-tick calculations for debugging and replay.

## Security Rules Outline
- Read access:
  - Allow read to `/sessions/{sessionId}` for any client while `status != "finished" || finishOrder.length === playerCount`.
- Write access:
  - Host (identified via session secret in `.env.local`) can `set` session root, update status, and write `distance`, `rank`, `finishTime`.
  - Spectators can `update` `/sessions/{sessionId}/players/{playerId}/cheerCount` using `increment(1)` if value stays ≤ `MAX_CHEER_PER_PLAYER` (configurable).
  - Only host may delete the session root during cleanup.
- Emulator parity:
  - `database.rules.json` mirrors the above, loaded in Firebase Emulator Suite for local testing.

## State Transitions
1. **pending**: Session created, players registered with zeroed distances and cheer counts.
2. **countdown**: Countdown overlay displayed; race tick loop not yet active.
3. **running**: Tick loop increments every second; distances updated; finish order captured.
4. **finished**: All players reached distance ≥1.0; result popup shown; cleanup timer initiated.

## Derived Calculations
- **Distance Update**: `distance += clamp(baseRngStep + cheerCount * cheerBoostFactor, 0, remainingDistance)` with `cheerBoostFactor` from research (e.g., `0.05`).
- **Rank Assignment**: On first frame a horse reaches `distance >= 1`, assign `rank = finishOrder.length + 1` and append `playerId` to `finishOrder`.
- **Cleanup**: When `status === "finished"` and result popup confirmed or window unloads, delete `/sessions/{sessionId}`.
