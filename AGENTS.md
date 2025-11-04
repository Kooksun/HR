# Repository Guidelines

## Project Structure & Module Organization
- Canonical GitHub remote lives at `https://github.com/Kooksun/HR.git`; keep `origin` pointing there to align branch automation.
- Root is intentionally lightweight: `.specify/` stores automation scripts and templates, `.codex/` tracks agent session metadata, and `specs/` holds feature folders named like `003-leave-approval`.
- Each feature folder contains `spec.md`, `plan.md`, and optional `tasks.md`, `research.md`, or `contracts/` for API schemas. Keep these docs authoritative—implementation branches should mirror the spec ID.
- Runtime code should live under `src/` (create it when you ship the first module) using Python packages (`src/hr/<module>.py`). Co-locate matching tests in `tests/`.
- Assets (fixtures, sample CSVs) belong in `resources/` inside the relevant feature folder so reviewers can trace provenance quickly.

## Build, Test, and Development Commands
- `./.specify/scripts/bash/create-new-feature.sh "Add leave accrual API"` scaffold a numbered feature workspace and returns its paths.
- `./.specify/scripts/bash/setup-plan.sh` copy the current plan template into your feature folder; run after branching.
- `python -m pytest` execute the full test suite once you add `tests/`. Prefer `PYTHONPATH=src` or use a tool like Poetry to manage dependencies.
- `black src tests` format Python modules in place; commit only clean diffs.

## Coding Style & Naming Conventions
- Use Black-compatible formatting (4-space indentation, 88-character lines). Prefer dataclasses and type hints for all public functions.
- Files and modules follow `snake_case.py`; classes use `PascalCase`; functions and variables stay `lower_snake_case`.
- Keep feature constants grouped in `src/hr/config.py` or a sibling module rather than scattering literals.

## Testing Guidelines
- Write pytest tests under `tests/feature_id/` mirroring the module name, e.g., `tests/003_leave_approval/test_policy.py`.
- Mark slow or integration tests with `@pytest.mark.slow` and hide them behind `pytest -m "not slow"` for CI.
- Target ≥90% branch coverage for new modules; add factories or fixtures under `tests/fixtures/` when reuse emerges.

## Commit & Pull Request Guidelines
- Branch names follow `NNN-short-description` to stay in sync with `specs/`. Example: `005-sync-payroll-holidays`.
- Start commit subjects with the spec number (`005: add accrual calculator`). Keep bodies wrapped at 72 characters and describe reasoning, not just changes.
- PRs must link to the spec and include: summary, testing evidence (`pytest` output or screenshots), and any schema or contract updates.
- Request review once specs, code, and docs align; if deviations exist, call them out explicitly in the PR checklist.

## Active Technologies
- JavaScript (ES2023 modules) + HTML5 + CSS3 (001-horse-racing-webapp)
- Firebase Realtime Database (`https://kooksun-hr-default-rtdb.firebaseio.com/`) (001-horse-racing-webapp)

## Recent Changes
- 001-horse-racing-webapp: Added JavaScript (ES2023 modules) + HTML5 + CSS3
