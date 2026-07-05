# Phase 4 — Client Detail functional spec (design/requirements revision + Brad sign-off)

> **Session-starter brief.** This is a **spec/design PR**, not a build. It produces the functional contract for the Client Detail screen, module by module, against real data — then gets **Brad's sign-off BEFORE Phase 5 (the build) starts.** Read `STATE.md`, this file, `~/Downloads/handoff/design-source/screens/client-detail.jsx` (layout authority only), `specs/10-trainer-features/{requirements,design}.md` (STORY-003), and `specs/_shared/cross-cuts.md § 1, § 2, § 3.7`.

## Why this phase exists

`client-detail.jsx` is **layout authority only** — the screen's _functionality_ was never specced. STORY-003 lists tabs but not data contracts. Before building (Phase 5), define what each module reads/writes against endpoints that actually exist, with empty states and rating bands. **Deliverable = a revision to `specs/10-trainer-features/design.md` + `requirements.md`** (new "Client Detail — functional contract" section, module by module) — NOT code.

Also fix, when landing: the spec calls Client Detail a "5-tab strip"; the prototype + `M8-coach/CLIENT_DETAIL_BRIEF.md` are a **single-scroll screen**. Correct the wording.

## Decisions already locked (don't relitigate)

- **AI Client Summary is LAUNCH scope** (Brad, 2026-07-05 — "a big USP"). Design it here (module g), build in Phase 6.
- **Scheduling / add-to-calendar: DO NOT DESIGN.** Parked as its own future spec (Phase 0 decision). Client Detail v1 ships without it.
- Single-scroll, not a tab strip.
- Goals need **no new data model** — `user_goals` already carries `target_value`/`current_value`/`unit` + `assigned_by_user_id` (cross-cuts § 2). Coach surfaces are reads/writes over it.

## Define each module against REAL data

Backend already live to consume: `GET /trainers/me/overview` (aggregate, powers Coach You — has a client-health metric), `GET /trainers/me/clients` (roster: 28-day adherence + band + last-seen + flags), `GET /trainers/me/clients/:clientId` (client detail — verify exact shape), client body-trend (#146), programs adherence/dashboard (#152), Phase 3 on-behalf GETs (sessions/measurements/goals). Habit configs backend (#129). Bedrock adapter seam + `ai_access` + daily AI ceilings (#153–#156).

- **a. Adherence rating** — from programs adherence endpoints (#152) + the overview 28-day metric. **Define the rating bands** (Strong / Wobbling / At Risk — reuse the roster's `clientBand` if one exists) + empty state (no assigned program / no sessions yet).
- **b. PR highlights** — parity read of the client's records/achievements. **Exact-rep PR rules only** (1rm/3rm/5rm/10rm on exact reps + max_weight + max_volume; **NO Epley estimates** — locked legacy-parity rule). Empty state.
- **c. Volume highlights** — parity read of weekly volume. **Mind the Drizzle GROUP BY trap** (42803 — group by ordinal; render via PgDialect to guard since the unit suite mocks getDb).
- **d. Calorie hit** — client nutrition day/week totals vs targets (±10% band, same rule as `nutrition_streak`). **Read-only for the coach.** ⚠ **PRIVACY LINE — ASK BRAD IN THE SIGN-OFF PING.** Default: coach sees **totals + adherence, NOT the food-level log**. Confirm before speccing the read.
- **e. Goals** — parity `GET` + assign/edit-own per cross-cuts § 2 (Phase 3 delivers the endpoints). Attribution: "Goal set by Coach {name}".
- **f. Habits** — coach view of the client's habit configs + weekly satisfaction (cross-cuts § 3.7); coach authorship endpoints per `specs/18-habit-setup`. Coach-set habits are complete-only for the client; edit-lock conditioned on an active relationship (transfers on relationship end).
- **g. AI Client Summary (launch scope)** — inputs = modules a–f. Generated via the **Bedrock adapter seam** (forced tool use, injectable client, **NO live calls in CI**). **Cached per client per day** — new table, e.g. `client_ai_summaries(trainer_id, client_id, date, summary, model, created_at)`; regenerate-on-demand. Counts toward the **coach's daily AI ceiling** (may need its own ceiling line per #156's pattern). Define: staleness copy + failure fallback (show the raw modules a–f). This is the design; Phase 6 builds it.
- **h. Scheduling / add-to-calendar** — **DO NOT DESIGN** (parked).

## On-behalf entry points to spec (used by Phase 5 build)

Log weight (exists), add assign-goal sheet, EditNutritionTargets sheet (**reuse the shipped Fuel Targets editor presenters** — don't rebuild), log session on-behalf. These consume Phase 3 endpoints.

## Deliverable + gates

- Edits to `specs/10-trainer-features/design.md` + `requirements.md` (functional-contract section per module; fix the "5-tab" wording). Prettier-clean (`bunx prettier --check` the changed md).
- Local inspector-brad sweep on the docs diff (it will check internal consistency + that cited endpoints/shapes exist — Phase 0's sweep caught 4 such errors, so this matters).
- PR raised; **ping Brad for SIGN-OFF before Phase 5**, and in that ping ASK the **calorie-hit privacy line** (module d default: totals + adherence, not the food log).

## Definition of done

Every module (a–g) has a data contract citing a real endpoint, rating bands + empty states defined, AI-summary cache table + ceiling + fallback specified, "5-tab" wording fixed, scheduling explicitly out; PR raised; Brad signed off; privacy line answered. Only then does Phase 5 start.
