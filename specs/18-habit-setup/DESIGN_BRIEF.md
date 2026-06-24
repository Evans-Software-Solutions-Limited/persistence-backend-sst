# Design Brief — Habit Setup screen

> **Status: FULFILLED (2026-06-23).** The hi-fi prototype was produced in Claude Design and lives at **`~/Downloads/habit_design/`** (`habit-setup.jsx`, `README.md`, `theme.css`, `ui.jsx`, `icons.jsx`, `fuel-targets.jsx`). That bundle — especially its `README.md` — is the FE source of truth and is cited directly by `requirements.md` and `design.md § 9`. This file is retained only as the historical brief + a pointer.

## What the prototype settled (and changed from the original brief)

- **5 categories**, not 4 — **Steps** added (violet/`trainer`, footprints). Order: water, gym, steps, sleep, calories.
- **One collection streak** across all habits (not per-habit), with shared freeze tokens in a top `StreakSection`.
- Forgiveness is **per-habit days/week** ("hit 5/7") + **freeze token = skip a whole week** + **holiday (on Home)** — there is **no per-habit cheat-day control**.
- **Calories target is read-only** (owned by Nutrition Fuel-Targets); the card deep-links to `fuel-targets.jsx`.
- **Holiday scheduling is NOT on this screen** — it lives on Home and applies to all habits; the footer just points there.

## Two follow-on decisions made after the prototype (Brad, 2026-06-23)

These are not visual — they're behaviour the screen must respect (captured in the spec):

1. **Coach can set a client's habits.** Coach-set habits render with "Set by Coach X" and are **complete-only** for the client (controls disabled). See `design.md § 5`.
2. **Two-way HealthKit sync, DB as source of truth.** Logging Water in-app writes to our DB + mirrors to Apple Health; Watch/3rd-party data flows in; trainers read values from the DB. See `design.md § 7`.

## Original brief (for the record)

The original text handed to Claude Design (5 categories, per-control bounds, tones, entry points, reuse-existing-primitives, out-of-scope) produced the bundle above. It has been superseded by `~/Downloads/habit_design/README.md`; refer to that for any FE detail.
