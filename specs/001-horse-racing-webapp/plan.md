# Implementation Plan: Horse Racing Webapp MVP

**Branch**: `001-horse-racing-webapp` | **Date**: 2025-11-04 | **Spec**: `specs/001-horse-racing-webapp/spec.md`
**Input**: Feature specification from `/specs/001-horse-racing-webapp/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Deliver a single-page race experience where the host enters up to ten players, runs a countdown, and animates emoji horses across horizontal tracks. Firebase Realtime Database synchronises spectator cheering counts that deterministically boost horse speed. Console telemetry captures tick-by-tick progress, Firebase reads, and final standings to satisfy observability requirements.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: JavaScript (ES2023 modules) + HTML5 + CSS3  
**Primary Dependencies**: Firebase Web SDK v11 modular build (Realtime Database), inline LCG RNG helper exported from `app.js`  
**Storage**: Firebase Realtime Database (`https://kooksun-hr-default-rtdb.firebaseio.com/`)  
**Testing**: Vitest (logic/jsdom) + Playwright (UI) served via `npx http-server`  
**Target Platform**: Evergreen browsers on desktop and mobile (Chrome, Safari, Edge, Firefox)  
**Project Type**: Single-page static web app  
**Performance Goals**: Tick loop executes ≤16 ms using `requestAnimationFrame` accumulator; Firebase cheer propagation observed within ≤1 s RTT  
**Constraints**: No build step; total asset budget ≤300 KB; must operate fully with Firebase Emulator Suite  
**Scale/Scope**: 2–10 player sessions, unlimited spectators, single active session per host tab

## Constitution Check (Pre-Design)

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- ✅ Single-page asset plan confirmed: limit deliverable to `index.html`, `style.css`, `app.js`.
- ⚠️ Simulation design documents a seedable randomness strategy and exposes formulas for Firebase-driven advantages (pending RNG research).
- ⚠️ Firebase data model and security rules drafted, plus emulator usage defined for local testing (pending Phase 1 design).
- ⚠️ Accessibility acceptance criteria captured (keyboard cheering controls, WCAG AA contrast, synchronized audio/animation timing) (requires UI research notes).
- ⚠️ Test and telemetry approach proves race timelines, Firebase events, and DOM updates before implementation starts (requires testing research outcome).

## Project Structure

### Documentation (this feature)

```text
specs/001-horse-racing-webapp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md (Phase 2)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
index.html
style.css
app.js
tests/
├── unit/
│   └── simulation.spec.js
├── integration/
│   └── race-flow.spec.js
└── e2e/
    └── cheer-mode.spec.ts
.firebase/
├── firebase.json
├── database.rules.json
└── emulator-config.json
.env.local (gitignored)
```

**Structure Decision**: Keep deployable surface to three static files. Modularise simulation and Firebase adapters inside `app.js` exports for unit tests. Dev tooling (Vitest, Playwright, Firebase emulator configs) lives alongside tests without affecting production assets.

## Phase 0 Research Focus

- Task: "Research lightweight seedable RNG for bundler-free ES modules (seedrandom vs custom LCG)" ✅
- Task: "Research bundler-free Vitest and Playwright setup for static assets" ✅
- Task: "Research tick scheduling approach ensuring 1 s cadence without animation jank" ✅
- Task: "Find best practices for Firebase Realtime Database cheering counters with emulator parity" ✅
- Output: Consolidated in `specs/001-horse-racing-webapp/research.md`.

## Phase 1 Design Preparation

- Document Firebase data model (session, players, cheers) with security rule outline.
- Draft RNG module API (seed input, deterministic distance calculation).
- Define accessibility acceptance tests (keyboard cheering, color contrast).
- Outline telemetry capture strategy (per-tick console traces + overlays).

## Accessibility Acceptance Criteria

- Keyboard-only flow: focusable player inputs, `Enter` triggers cheer, `Space` triggers start button.
- WCAG AA colour contrast: lane backgrounds vs text ≥4.5:1; countdown modal uses ≥18 pt text.
- Motion guidelines: animation respects `prefers-reduced-motion` by switching to discrete distance jumps.
- Screen reader announcements: countdown updates via `aria-live="assertive"`; results popup lists ranks with `<ol>`.

## Telemetry & Testing Strategy

- RNG + simulation unit tests in Vitest validate deterministic results for known seeds.
- Playwright smoke scenarios:
  1. Host flow from name entry to results with seeded finish order.
  2. Spectator cheer increments reflected within two ticks.
- Firebase Emulator used in all automated tests with fixture data exported/imported per run.
- Console logging schema: `tick:<n>` lines include `base`, `cheerBoost`, `total`, `distance`, `cheerCount`.

## Constitution Check (Post-Design)

- ✅ Single-page asset plan confirmed: limit deliverable to `index.html`, `style.css`, `app.js`.
- ✅ Simulation design documents a seedable randomness strategy and exposes formulas for Firebase-driven advantages.
- ✅ Firebase data model and security rules drafted, plus emulator usage defined for local testing.
- ✅ Accessibility acceptance criteria captured (keyboard cheering controls, WCAG AA contrast, synchronized audio/animation timing).
- ✅ Test and telemetry approach proves race timelines, Firebase events, and DOM updates before implementation starts.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | — | — |
