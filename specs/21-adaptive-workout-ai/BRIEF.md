# spec-21 — Adaptive Workout AI (“AnyGym”) · Phase 0 brief

> **STATUS: PARKED — build AFTER launch.** Persistence ships in its current
> state first (see `specs/milestones/GO-LIVE-FINAL/`). AnyGym is the flagship
> **Premium+** feature the marketing site advertises as “Coming soon · w/c 17
> Aug” (`packages/web`, non-linking until `config.appStore` flips). This file
> captures the first executable slice so it’s ready to pick up post-release; it
> is a brief, not yet the full `requirements.md`/`design.md`/`tasks.md` triplet
> (author that when the work goes active, per the repo’s Kiro spec discipline).

## Concept (from the design handoff)

AnyGym = **ADAPT an existing workout/programme to the equipment actually
available** — _not_ generate-from-scratch (that’s a separate flow). From a
workout (athlete) or programme (coach), the user taps **Apply AnyGym**, collects
what kit is on hand (scan / manual / a saved gym), and the app re-maps the plan
to that kit — keeping the training targets, swapping only what’s needed, with a
per-swap reason. The result is saved as a **variation grouped under the parent**;
the original is never mutated.

Reference (design prototypes, read before speccing):
`~/Downloads/design_handoff_site_and_anygym/README.md` (§ AnyGym Journey + §
State Management) and `Persistence - GTM D7 AnyGym.html`
(`src/screens/gtm-d7-anygym.jsx`) — flow: `detail → collect → scan/manual →
adapting → review (per-row SWAPPED/KEPT + reason) → saved`. “AnyGym” is always
one word.

## Why Phase 0 is backend + data-model only

The handoff README flags a hard prerequisite: **resolve the parent↔variation
linkage and saved-gym persistence _before_ building AnyGym.** No `specs/21`
existed until this brief. This slice makes those decisions and ships the schema
and endpoints the later mobile/AI slices consume — agent-executable, no device
gate.

## Decisions to make + implement (core of Phase 0)

1. **Parent ↔ variation linkage** — store an adapted workout/programme as a
   variation grouped under its parent, original untouched, also surfaceable in a
   saved list. _Recommended default (confirm with Brad):_ nullable
   self-referential `parent_workout_id` + `variation_kind` + `source_gym_id` on
   the workouts table (and the programme equivalent).
2. **Saved-gym persistence** — a reusable equipment config (name + equipment
   set), referenced by variations and listed in Settings/Profile. _Recommended:_
   a `saved_gyms` table (`user_id`, `name`, `equipment_type_ids uuid[]`) with an
   FK from the variation.

Reuse — **do NOT rebuild:** the equipment model already exists
(`equipment_types` table, `equipment_required` on exercises, `available_equipment`
arrays in `packages/db/src/schema.ts`); the deterministic **substitute-exercise
ranker** (that’s the D6 “smart swap”); the **M9.5 Bedrock adapter** pattern
(`project_m95_snap_ai`) for the later generation call; server-derived Premium+
entitlements (M9.5 pattern).

## Deliverables (Phase 0)

- `specs/21-adaptive-workout-ai/` triplet (requirements + design + tasks) once
  the data-model decisions are confirmed.
- Idempotent migration(s) (Neon/Supabase-as-is) + `schema.ts` mirror for the
  linkage + `saved_gyms`.
- Repository + Elysia endpoints, all `userId`-scoped with explicit ownership
  checks: saved-gym CRUD; create-variation-under-parent; list variations for a
  parent. **Premium+ entitlement guard** on create paths.
- ≥90% unit coverage on changed files; render the real WHERE via `PgDialect` in
  a test to dodge the mocked-`getDb` blind spot (see
  `reference_drizzle_groupby_param_bug`).

## Out of scope (later slices)

The mobile AnyGym flow UI (D7), the equipment-scan capture (D1), the shared
equipment-aware swap component (D6, used by both D6 and the AnyGym review step),
and the actual AI re-mapping/generation call. Phase 0 is only the data model +
endpoints they’ll build on.

## Gates

`bun run typecheck · lint · prettier:check · build · test:unit` (≥90% on changed
files) + Inspector-Brad-local before the PR; merge on green.

---

## Readiness sense-check (2026-07-24)

Brad asked whether AnyGym is "fully scoped, ready to be picked up next."
Verdict: **brief-ready, not build-ready.** What stands between this file and a
pickup-able state:

1. **The triplet doesn't exist.** This is a Phase-0 brief; per the header the
   `requirements.md`/`design.md`/`tasks.md` triplet is authored when work goes
   active. That authoring session (~1 focused session) is the actual next step.
2. **Designs exist but live off-repo.** Brad confirms the Claude design
   prototypes are ready (`design_handoff_site_and_anygym` — D7 journey, D1
   scan, D6 swap). They are referenced by a `~/Downloads` path; commit them (or
   a stable exported copy) somewhere durable before the authoring session so a
   remote/parallel agent can read them.
3. **Two data-model decisions are still open** (parent↔variation linkage;
   saved-gym persistence — recommended defaults are in § Decisions above,
   needing only Brad's confirm).
4. **Tier-gating divergence to reconcile:** the GTM-EXPANSION § 3 table gives
   Premium 10/day generation+scan; `marketing/WEBSITE_PRICING_SPEC.md` (later,
   shipped to the site) makes scan+generation a hard Premium+ gate — and its
   2026-07-17 revision **dropped the free AI taster entirely** (Free's cap is
   now "3 Custom Workouts", superseding both the GTM table and the pricing
   spec's own § 6.1/§ 7 taster copy). The triplet should inherit the latest
   pricing-spec position, confirm the taster's fate with Brad, and note P0
   (premium_plus tier restructure) is now a **shared prerequisite with spec-26
   AnyMeal**.
5. **Adapt-vs-generate scope is settled** (this brief: AnyGym = adapt-existing;
   generate-from-scratch is the separate M19-P2 flow) — carry that split into
   the triplet explicitly, since the marketing copy blurs them.

Not blockers: the equipment model, swap ranker, Bedrock adapter, entitlement
and ceiling patterns are all shipped and verified (§ Reuse).
