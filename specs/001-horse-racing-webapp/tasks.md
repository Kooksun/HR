# Tasks: Horse Racing Webapp MVP

**Input**: Design documents from `/specs/001-horse-racing-webapp/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are required by constitution (simulation RNG, Firebase events, DOM updates). Each story phase lists associated test tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and baseline tooling

- [X] T001 Create static asset scaffold (`index.html`, `style.css`, `app.js`) and testing folders `tests/unit`, `tests/integration`, `tests/e2e`
- [X] T002 Initialize npm dev tooling with Vitest, Playwright, Firebase CLI in `package.json`
- [X] T003 Add environment template `.env.local.example` documenting Firebase keys and `SESSION_SECRET`
- [X] T004 Configure Firebase emulator and hosting metadata in `firebase.json`, `.firebase/emulator-config.json`, `database.rules.json`
- [X] T005 Register npm scripts for `vitest`, `playwright`, `firebase emulators:start`, and static serving via `http-server` in `package.json`

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T006 Implement Firebase config loader and mode detection (host vs spectator) in `app.js`
- [X] T007 [P] Implement seedable LCG helper `createRng(seed)` exported from `app.js`
- [X] T008 [P] Define simulation constants (`TICK_MS`, `CHEER_BOOST_FACTOR`, lane layout) and shared state container in `app.js`
- [X] T009 [P] Implement Firebase cheer transaction helper using `runTransaction` in `app.js`
- [X] T010 Instrument telemetry logger utilities (`logSession`, `logTick`, `logFirebase`) inside `app.js`
- [X] T011 Document Firebase data schema and security rule summary in `specs/001-horse-racing-webapp/quickstart.md`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

## Phase 3: User Story 1 - Host Starts Race (Priority: P1) 🎯 MVP

**Goal**: Host enters players, triggers countdown, and runs deterministic race to completion

**Independent Test**: Seeded race with 4 players executes countdown, animates emoji horses, logs per tick, and displays ordered results using only host tab.

### Tests for User Story 1 (required)

- [ ] T012 [P] [US1] Write Vitest unit tests for countdown scheduling and RNG determinism in `tests/unit/simulation.spec.js`
- [ ] T013 [P] [US1] Create Playwright scenario covering host flow from name entry to results in `tests/integration/race-flow.spec.js`

### Implementation for User Story 1

- [ ] T014 [US1] Build host control form and race track markup in `index.html`
- [ ] T015 [P] [US1] Style track lanes, countdown modal, and result popup to meet WCAG AA in `style.css`
- [ ] T016 [US1] Render tracks and countdown overlay dynamically from player list in `app.js`
- [ ] T017 [US1] Implement `requestAnimationFrame` tick loop progressing horses and enforcing 1 s cadence in `app.js`
- [ ] T018 [P] [US1] Implement finish detection, ranking assignment, and result modal wiring in `app.js`
- [ ] T019 [US1] Emit per-tick telemetry logs (base step, cheer boost, total distance) to console in `app.js`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

## Phase 4: User Story 2 - Spectator Cheer Mode (Priority: P2)

**Goal**: Spectator clients detect active race, cheer for players, and boost horse speed via Firebase

**Independent Test**: Join existing session as spectator, press cheer button thrice, observe Firebase increment and boosted movement on host within two ticks.

### Tests for User Story 2 (required)

- [ ] T020 [P] [US2] Add Vitest coverage for spectator mode detection and cheer count amplification in `tests/unit/spectator.spec.js`
- [ ] T021 [P] [US2] Extend Playwright scenario validating cheer latency and UI state in `tests/e2e/cheer-mode.spec.ts`

### Implementation for User Story 2

- [ ] T022 [US2] Inject spectator cheer controls container and status banners in `index.html`
- [ ] T023 [P] [US2] Style cheer buttons with focus rings and responsive layout in `style.css`
- [ ] T024 [US2] Implement spectator mode detection and cheer button rendering in `app.js`
- [ ] T025 [US2] Wire cheer button events to Firebase transactions and debounce rapid taps in `app.js`
- [ ] T026 [P] [US2] Apply cheer-derived boost calculations inside tick loop and log `cheerBoost` component in `app.js`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

## Phase 5: User Story 3 - Session Lifecycle & Cleanup (Priority: P3)

**Goal**: Ensure session init, state persistence, and cleanup protect Firebase from orphaned data

**Independent Test**: Start race, close host tab, confirm `/sessions/{sessionId}` node removed within 5 seconds and reloading starts fresh session.

### Tests for User Story 3 (required)

- [ ] T027 [P] [US3] Create Vitest tests for session init, status transitions, and cleanup hooks in `tests/unit/session.spec.js`
- [ ] T028 [P] [US3] Add Playwright coverage verifying database cleanup on finish/unload in `tests/e2e/cleanup.spec.ts`

### Implementation for User Story 3

- [ ] T029 [US3] Initialize session document with players, seed, and status lifecycle in `app.js`
- [ ] T030 [P] [US3] Implement window `beforeunload` cleanup deleting session path and logging outcome in `app.js`
- [ ] T031 [US3] Trigger cleanup after result confirmation and reset UI state in `app.js`

**Checkpoint**: All user stories should now be independently functional

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T032 Run Lighthouse accessibility audit and address contrast/keyboard findings in `index.html` and `style.css`
- [ ] T033 [P] Add `prefers-reduced-motion` handling and discrete animation fallback in `style.css`
- [ ] T034 [P] Document telemetry usage and emulator workflow updates in `specs/001-horse-racing-webapp/quickstart.md`
- [ ] T035 [P] Add README section summarizing host vs spectator usage and testing commands in `README.md`

---

## Dependencies & Execution Order

- **Story order**: US1 → US2 → US3 (spectator mode requires host race; cleanup depends on both flows)
- **Phase prerequisites**:
  - Phase 1 must complete before Phase 2
  - Phase 2 must complete before any user story work
  - Each story’s implementation follows its test tasks (tests first, then code)
- **Cross-story dependencies**: US2 cheer boost logic relies on tick loop from US1; US3 cleanup reuses session schema from foundational tasks.

## Parallel Opportunities

- Phase 2 tasks T007–T010 can proceed in parallel after Firebase loader (T006) is ready.
- Within US1: styling (T015) and finish modal (T018) can run alongside tick loop implementation once markup exists.
- Within US2: cheer styling (T023) and boost calculations (T026) can proceed simultaneously after spectator markup task T022.
- Within US3: unload handler (T030) and cleanup triggers (T031) may run in parallel after session init T029.

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Phases 1–2.
2. Deliver US1 tasks through T019 and validate deterministic race flow.
3. Ship MVP enabling host-only races before layering spectator features.

### Incremental Delivery
1. Deploy host race (US1) with telemetry.
2. Enable spectator cheering (US2) and validate latency.
3. Harden lifecycle management (US3) and release cleanup safeguards.

### Parallel Team Strategy
1. Pair A tackles Firebase + RNG foundations while Pair B prepares UI scaffold.
2. After foundation, Pair A implements US1 simulation while Pair B builds spectator UI/tests.
3. Rotate to US3 cleanup and polish tasks once US1/US2 merged.

---
