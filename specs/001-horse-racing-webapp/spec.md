# Feature Specification: Horse Racing Webapp MVP

**Feature Branch**: `001-horse-racing-webapp`  
**Created**: 2025-11-04  
**Status**: Draft  
**Input**: User description: "* 플레이어들을 경주마로 표현하고 랜덤하게 진행시켜 승자를 뽑는 시뮬레이션 게임 웹앱이다. * 프로젝트는 심플하게 구성하여 index.html, style.css, app.js 으로 이루어진다. * 게임 세션은 Firebase를 연동해서 플레이어들을 응원하면 어드밴티지를 주는 것이 특징이다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Host Starts Race (Priority: P1)

As the host, I want to enter player names and start a race so that friends can watch the horses and see who wins.

**Why this priority**: Core gameplay loop; without this there is no experience for any participant.

**Independent Test**: Using a seeded simulation, verify that a race runs end-to-end with countdown, animations, and ordered results using only local input.

**Acceptance Scenarios**:

1. **Given** the host enters 4 unique names and clicks start, **When** the countdown reaches zero, **Then** each track animates left-to-right and logs per-tick progress until all horses finish.  
2. **Given** the race finishes, **When** the result popup appears, **Then** players are listed in finish order with ranks and the console logs the final standings.

---

### User Story 2 - Spectator Cheer Mode (Priority: P2)

As a remote spectator, I want to join an active race and cheer for my favourite horse so that my cheering meaningfully affects the outcome.

**Why this priority**: Differentiating feature requiring Firebase; vital to connect spectators to the race host.

**Independent Test**: With an active session already started, open a second client, cheer for a horse, and confirm Firebase increments the advantage and the host's race reflects amplified movement.

**Acceptance Scenarios**:

1. **Given** the database contains an active session, **When** a spectator loads the page, **Then** they see cheer buttons instead of race controls and the console logs that spectator mode is active.  
2. **Given** the spectator taps a cheer button three times, **When** one second ticks, **Then** the database stores the incremented cheer count and the horse gains extra distance logged in both clients.

---

### User Story 3 - Session Lifecycle & Cleanup (Priority: P3)

As a maintainer, I want session state to initialize and clean up automatically so that Firebase stays tidy and races do not conflict.

**Why this priority**: Prevents orphaned data and ensures deterministic behaviour across runs.

**Independent Test**: Start a race, reload or close the host tab, and verify the database path is deleted; start a new race and confirm fresh initialization succeeds.

**Acceptance Scenarios**:

1. **Given** the host starts a race, **When** the countdown begins, **Then** Firebase stores each player with a cheer count of zero and logs the write.  
2. **Given** all horses finish or the host navigates away, **When** the unload event fires, **Then** the database node is deleted and the console logs the cleanup outcome.

---

### Edge Cases

- What happens when fewer than 2 or more than 10 names are submitted?
- How does the system handle duplicate player names?
- How is advantage resolved if simultaneous cheering events arrive at the same tick?
- What occurs when Firebase connectivity drops mid-race?
- How are race animations handled if the browser tab is backgrounded or throttled?

### Firebase & Advantage Flow *(mandatory)*

- **Cheering Payload**: `{ playerId, intensity, timestamp }`
- **Advantage Formula**: `tickDistance = baseRandom(0.2-0.8) + (cheerCount * cheerBoostFactor)` where `cheerBoostFactor` is deterministic and capped per tick.
- **Security Rules**: `write` rules allow only authenticated host writes to `/sessions/{sessionId}/players/*` for initialization and allow public cheering increments via callable cloud rules that enforce existing player IDs.
- **Emulator Strategy**: Use Firebase Emulator Suite with seeded cheering scripts to replay increments; tests point `FIREBASE_EMULATOR_HOST` to localhost and reset state between cases.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST render the full race UI from `index.html` using assets in `style.css` and `app.js`.
- **FR-002**: System MUST apply cheering advantages only through Firebase events and document the multiplier math.
- **FR-003**: Users MUST be able to trigger cheering via keyboard and pointer inputs with equal effectiveness.
- **FR-004**: System MUST expose a deterministic seed hook that replays a race when provided with the same inputs.
- **FR-005**: System MUST emit telemetry or logs that reconstruct final standings and cheering deltas.
- **FR-006**: System MUST handle session initialization, spectator detection, and cleanup against `https://kooksun-hr-default-rtdb.firebaseio.com/`.

*Example of marking unclear requirements:*

- **FR-007**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-008**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(include if feature involves data)*

- **Session**: `{ sessionId, status, createdAt }` representing host-controlled race instances.
- **Player**: `{ name, laneIndex, distance, cheerCount }` stored under `/sessions/{sessionId}/players/{playerId}`.
- **TickLog**: Derived telemetry stored client-side for debugging `{ timestamp, playerSnapshots[] }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Host can start and complete a race with up to 10 players in under 2 minutes on a mid-tier laptop.
- **SC-002**: Spectator cheering increments reflect in host animation within 1 second round-trip latency.
- **SC-003**: Accessibility audit (Lighthouse) achieves ≥90 score; keyboard-only cheering completes User Story 2 workflow.
- **SC-004**: Firebase database is cleared within 5 seconds of race completion or window unload.
