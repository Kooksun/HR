# UI Overhaul Execution & Implementation Plan

Author: Codex Agent • Date: 2025-11-13  
Scope: Reimagine the Horse Racing Arena UI to visualise overlapping players on a shared oval track with lap-based progress and color-coded player identities.

## Requirements Traceability

| # | Requirement | Planned Response |
|---|-------------|------------------|
| 1 | Overlay all players on a single track | Replace per-lane DOM with one oval track canvas that renders every runner in shared space. |
| 2 | Show player number above emoji | Generate numeric badges bound to player order (1‑indexed) and render them inside each runner marker. |
| 3 | Arena layout = left player list + central track | Restructure `<main>` into a two-column grid (left list, center oval, right spectator panel). Player list becomes vertically scrollable if needed. |
| 4 | Track visual is oval | Use SVG-based oval track with gradient fill + dashed centerline. Maintain clear start/finish glyphs. |
| 5 | Horses travel CCW | Position calculations convert race progress into counterclockwise polar coordinates. |
| 6 | Start at 1 o’clock, finish at 11 o’clock | Define start angle = 30° (≈1 o’clock) and finish area = 330° (≈11 o’clock), with visual markers. |
| 7 | Race = n laps from start to finish | Extend simulation state with `lapsRequired` (>=1) and compute progress = lapsCompleted + partial lap. Finish triggers when progress ≥ n and runner crosses finish window. |
| 8 | Player list + emoji share unique background colors | Generate deterministic palette from player index, expose CSS custom properties so both list chips and runner badges reuse the same color token. |

## Assumptions & Decisions

- Lap count is host-configurable via new numeric input (defaults to 1); countdown/start UX unchanged.
- Existing Firebase schema stays intact; lap logic derived from client-side race state (distance mapped to laps).
- Spectator cheer UI remains functional on the right column without behavioural changes.
- SVG rendering occurs via DOM updates (no canvas dependency) to keep current build-free workflow.

## Execution Plan

### Phase 1 – Data & Simulation Prep
1. **Lap semantics**: Introduce `lapsRequired` configuration (new form field) and derive `totalTrackDistance = lapsRequired * BASE_TRACK_LENGTH`. Map existing normalized `distance` into laps.
2. **Angle math utilities**: Add helpers to convert normalized lap progress into CCW polar coordinates relative to track center; clamp to `[0, 2π * lapsRequired]`.
3. **Color registry**: Create deterministic palette (e.g., HSL wheel spaced by golden-ratio increments). Store on each player as `color` and expose via CSS variables (`--player-color-id`).

### Phase 2 – Layout Restructure
1. Update `index.html` to include:
   - `player-roster` sidebar containing player cards (name, color swatch, lap progress meter).
   - `track-stage` wrapper housing new SVG oval and overlays (start marker, finish gate).
   - Move spectator panel to right column (or keep existing placement but update grid).
2. Adjust `style.css`:
   - Define responsive grid for `.arena` (left 240px sidebar, flexible center, optional right panel).
   - Ensure mobile breakpoint collapses columns vertically while preserving reading order (list → track → spectators).

### Phase 3 – Track Rendering
1. Implement `<svg>` oval track:
   - Outer oval path (stroke + fill).
   - Inner dashed guide or center line for depth.
   - Start marker (flag icon) at 1 o’clock and finish arch at 11 o’clock.
2. Add overlay layer for dynamic elements: runner markers, lap counters, ghost trail.
3. Provide CSS for track shading, motion blur, and start/finish labels.

### Phase 4 – Runner Visuals & Movement
1. Replace per-lane DOM nodes with a `runner` component (emoji + badge + colored halo). Each runner absolutely positioned via `transform: translate(-50%, -50%)`.
2. Compute XY coordinates:
   - `angle = startAngle - (progressFraction * 2π)` so movement reads counterclockwise.
   - `x = centerX + radiusX * cos(angle)` and `y = centerY - radiusY * sin(angle)` (SVG coordinate system).
3. Update animation loop to adjust both `distance` and derived `lapCount`. Use CSS transitions or `requestAnimationFrame` updates for smooth CCW motion.

### Phase 5 – Player List Enhancements
1. For each player card, show:
   - Color chip + player number.
   - Name text, cheer count, lap progress bar (percentage of total laps).
2. Sync color token between card, runner badge, and spectator buttons (for quick selection).
3. Ensure accessible contrast by mixing color tokens with dark/light variants (calc in JS or via CSS `color-mix`).

### Phase 6 – Testing & Telemetry
1. **Unit tests**: Expand simulation specs to cover lap math (`distanceToAngle`, multi-lap finish detection).
2. **Integration tests**: Update Playwright scenario to assert that runners share same track and lap counter updates.
3. **Manual checks**: Verify responsive layout, color consistency, and that CCW angles align with start/finish requirements.

## File-Level Implementation Plan

### `index.html`
- Replace `.tracks` section with:
  ```html
  <section class="arena-layout">
    <aside id="player-roster"></aside>
    <section id="oval-track" aria-live="polite">
      <svg ...>…</svg>
      <div id="runner-layer"></div>
    </section>
    <aside id="spectator-panel">…</aside>
  </section>
  ```
- Add lap count input in host form (`<input type="number" min="1" id="lap-count">`).
- Include start/finish labels and optional legend describing direction.

### `style.css`
- Define CSS grid for `.arena-layout` with template `240px 1fr 300px` (collapse on small screens).
- Style `#player-roster` cards using `var(--player-color-X)` custom properties.
- Create reusable classes: `.runner`, `.runner-badge`, `.runner-emoji`, `.runner-shadow`.
- Style oval track via SVG-specific selectors (`.track-rail`, `.track-inset`, `.track-line`).
- Ensure spectator panel matches new column height and gets sticky scrolling if needed.

### `app.js`
- Extend state with `lapsRequired`, `trackGeometry` (width/height/padding), and `playerColors`.
- Update host form submission to read lap count; persist to Firebase session payload so spectators know required laps.
- Replace lane rendering logic with functions:
  - `renderPlayerRoster(players)`
  - `renderTrack(players)`
  - `updateRunnerPositions(tickDelta)`
- Add math helpers:
  ```js
  function normalizeProgress(distance, lapsRequired) { … }
  function progressToAngle(progress) { … } // returns radians CCW from 1 o’clock
  function angleToPoint(angle, geometry) { … }
  ```
- When race completes, final standings still derived from finish order but now consider lap/angle window.
- Update telemetry to log `lap`, `angleDeg`, `distancePct`.

### `tests/*`
- Update/extend unit tests to validate `progressToAngle` and lap-based finish detection.
- Adjust integration mocks to assert DOM contains single track and runner badges.

## Validation Checklist
- [ ] CCW movement verified visually and by logging angle decreasing steadily.
- [ ] Start marker at 1 o’clock, finish gate at 11 o’clock (≈30° & 330°).
- [ ] Multi-lap races finish only after n complete revolutions plus finish window.
- [ ] Player list + runner badges use same color (checked via computed style).
- [ ] Responsive layout keeps roster, track, spectator sections legible on ≤768 px widths.
- [ ] Spectator cheering still boosts runners; telemetry logs include new lap fields.

## Open Questions
1. Should lap count be host-editable UI or derived from spec? (Assumed host input; confirm with stakeholder.)
2. Do we need per-player lap indicators on the track (e.g., ghost markers) or is roster progress bar sufficient?
3. Are there accessibility preferences for color assignments (e.g., avoid red/green pairing)?
