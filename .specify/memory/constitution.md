<!-- Sync Impact Report:
- Version change: - → 1.0.0
- Modified principles: Initial publication baseline
- Added sections: Core Principles; Platform Constraints & Architecture; Development Workflow & Quality Gates; Governance
- Removed sections: None
- Templates requiring updates: ✅ .specify/templates/plan-template.md; ✅ .specify/templates/tasks-template.md; ✅ .specify/templates/spec-template.md
- Follow-up TODOs: None
-->
# HR Horse Racing Webapp Constitution

## Core Principles

### I. Single-Page Simplicity
The production bundle MUST stay limited to `index.html`, `style.css`, and `app.js`. No bundlers, transpilers, or extra entrypoints may be introduced. All gameplay logic lives in `app.js`, and any shared utilities are implemented inline or as immediately invoked modules to preserve load speed from static hosting. Node-based tooling is acceptable only for linting or tests and MUST ship zero runtime dependencies.

### II. Fair Simulation Control
Race progression randomness MUST be auditable and seedable. Expose a deterministic seed hook for automated tests and Firebase-sourced advantages, and ensure every modifier applied to a horse is traceable. Hidden multipliers or side channels are prohibited; cheering empowers players only via declared formulas.

### III. Firebase-Centric Engagement
Firebase Realtime Database or Firestore is the sole source of truth for cheering signals, session state, and advantage tallies. All reads and writes route through Firebase SDK calls, backed locally by the Firebase emulator suite. Security rules MUST reject unauthenticated writes outside the cheering API surface.

### IV. Responsive & Inclusive Experience
The interface MUST deliver frame-by-frame race updates, keyboard-accessible cheering controls, and WCAG AA color contrast. Animation timing and audio cues stay synchronized within ±100 ms so remote spectators perceive consistent outcomes across devices.

### V. Testable Telemetry
Automated tests MUST cover the simulation engine, Firebase event handling, and DOM updates. Capture race timelines and cheering deltas via console tracing or lightweight overlays to support replay validation. Ship no feature without an accompanying test or instrumentation that proves the principle it touches.

## Platform Constraints & Architecture

- Host the app as static assets (e.g., Firebase Hosting, GitHub Pages) with HTTPS enforced.
- Store Firebase project configuration in `.env.local` and mirror it in the Firebase emulator config for local play.
- Define cheering payloads as `{ playerId, intensity, timestamp }` and persist the resulting advantage multiplier per session.
- Keep assets under 300 KB combined to maintain instant loads on mobile networks; optimize images and inline SVGs as needed.
- Document every Firebase collection or path touched inside `specs/[feature]/data-model.md`.

## Development Workflow & Quality Gates

- Initiate every change with a numbered feature branch and complete `spec.md`, `plan.md`, and `tasks.md` before implementation.
- Constitution Check gates: single-page asset plan validated, randomized logic seeding strategy documented, Firebase rules and emulator usage specified, accessibility acceptance tests defined.
- Use the Firebase emulator for all local testing; production credentials are forbidden in development commits.
- Submit PRs only after the static assets load locally without a build step, automated tests pass (`vitest` or similar for JS logic plus Playwright/Cypress smoke tests), and telemetry captures the new interactions.

## Governance

This constitution supersedes conflicting guidance in the repository. Amendments require consensus from the maintainers and documentation of rationale inside the PR description. Semantic versioning governs updates: increment MAJOR for principle reversals, MINOR for new principles or workflow gates, PATCH for clarifications. Every release of this document MUST list compliance checks in the accompanying Sync Impact Report. Reviews and deployment approvals confirm adherence before merge.

**Version**: 1.0.0 | **Ratified**: 2025-11-04 | **Last Amended**: 2025-11-04
