# 21 — Loadout (equipment-adaptive workouts): Requirements

**Status:** Draft · **Author:** Claude (Opus) · **Date:** 2026-07-25
**Milestone:** M19 (GTM-EXPANSION) · **Tier:** Premium+ (hard gate)

> **Naming.** The feature is **Loadout** (one word, capital L). It was called
> "AnyGym" until the 2026-07-24 rename (availability vetting found AnyGym Ltd, a
> UK company — see `marketing/WEBSITE_PRICING_SPEC.md` § 5, the brand decision
> record). The marketing site and pricing spec already say Loadout (PR #311);
> **the design-handoff bundle still says AnyGym** (`~/Downloads/Any Gym/project/`
> — `Persistence - GTM D7 AnyGym.html` → `src/screens/gtm-d7-anygym.jsx`, plus
> D1 scan and D6 swap). Read the handoff as Loadout. `BRIEF.md` in this
> directory predates the rename and is superseded by this triplet.

## Problem

An athlete's plan assumes the kit they normally train with. The moment that
changes — travelling, a hotel gym, a home garage, a busy squat rack — the plan
is unusable and the session either degrades into improvisation or does not
happen. The same is true for a coach whose client is away from their usual gym:
the coach must hand-edit a programme per location, or accept the client going
off-plan.

Persistence already holds every ingredient needed to solve this and does not
join them up:

- `equipment_types` is a seeded reference table; exercises carry
  `equipment_required`; profiles carry `available_equipment`.
- The exercise library is large enough that an equipment-compatible alternative
  almost always exists for a given movement.
- There is **no** way to say "here is the kit I have today" and **no** way to
  hold more than one version of a workout — editing a workout destroys the
  original.

## What Loadout is (and is not)

**Loadout ADAPTS a plan you already have.** From a workout (athlete) or a
programme (coach), the user collects what kit is available — scan, manual
picklist, or a **saved gym** — and Persistence re-maps the plan to that kit,
**keeping the training targets** (sets, reps, superset structure, order) and
swapping only the exercises that the kit cannot support, with a per-swap reason.

The result is saved as a **variation grouped under the parent**. The original is
never mutated.

**Loadout is not generate-from-scratch.** Free-text "build me a workout" is a
separate flow (M19-P2, prototyped as design D2) and must not be merged into
this one. It is also not program import (a separate workstream).

## Decisions (locked — do not reopen)

| #   | Decision             | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Mental model         | **Adapt an existing workout/programme.** Generate-from-scratch is a separate flow.                                                                                                                                                                                                                                                                                                                                                              |
| D2  | Parent ↔ variation   | Nullable self-referential `parent_workout_id` + `variation_kind` + `source_gym_id` on `workouts`, and the programme equivalent. Original never mutated.                                                                                                                                                                                                                                                                                         |
| D3  | Saved gyms           | New `saved_gyms` table (`user_id`, `name`, `equipment_type_ids uuid[]`); a variation FKs to the gym it was adapted for.                                                                                                                                                                                                                                                                                                                         |
| D4  | Tier                 | **premium_plus** — £29.99/mo, £299.99/yr. **Hard gate, no free taster.** RevenueCat promotional entitlements are the only comp/promo mechanism.                                                                                                                                                                                                                                                                                                 |
| D5  | Reuse, don't rebuild | `equipment_types`; the M9.5 Bedrock adapter (`aiBedrockClient.ts` + `aiEstimation.ts`); the #156 entitlement + `ai_usage_log` ceiling pattern; `exerciseRepository`'s visibility predicate and filter assembly. **Correction — see § Premise correction: the "deterministic substitute ranker" is _not_ shipped and must be built here.**                                                                                                       |
| D6  | No fuzzy matching    | Any model call selects **ids from a candidate list supplied in the prompt**, validated for membership in TypeScript after parsing. Free-text name → id resolution is never used. Architecturally twinned with `specs/26-mealprint-meal-planning/design.md` § 1 — see `design.md` § Twinning.                                                                                                                                                    |
| D7  | Re-map engine (v1)   | **DECIDED 2026-07-26 by the E2 bake-off: the HYBRID** — deterministic § 6.2 shortlist (top 25/row) → model selection → model reasons, Haiku-class. Beat the ranker 50–4 on blind preference; tied the full-pool model arm 25–25 at 29 % of its cost. Evidence: `scratchpad/loadout-phase-e/VERDICT-E2.md`, `design.md` § 6.0. What did **not** move to the model: equipment containment, read-visibility and the parent's sets/reps/rest/order. |

## Premise correction (2026-07-25)

Two "reuse, don't rebuild" premises inherited from `BRIEF.md` § Reuse and the
kickoff do not hold against the code. Recorded here so no later session
re-discovers them:

1. **There is no deterministic substitute-exercise ranker.** The brief's
   reference is forward-looking (GTM-EXPANSION M19-P3, unbuilt). What exists is
   (a) an **orphaned Postgres function** `get_alternative_exercises`
   (`supabase/migrations/002_functions_and_triggers.sql:432`) with a real
   scoring formula — 50 primary-muscle overlap / 20 secondary / 15 difficulty
   match / +15 −30 equipment — that has **zero TypeScript callers, no route and
   no tests**; and (b) `SwapExercisePopover`, an unranked client-side
   primary-muscle filter that documents its own gap ("V2 has no `similar_to`
   API"). **The ranker is net-new work in this spec** (Phase 1), reconciled
   against that prior art in `design.md` § Ranker.
2. **Equipment matching semantics are the opposite of what exists.**
   `exerciseRepository`'s `equipmentAny` filter is array **overlap** (`&&`,
   "needs at least one thing I have"). Loadout needs **containment** (`@>`,
   "everything it needs, I have"). This is a new filter axis, not a reuse — a
   silent overload of `equipmentAny` would return exercises the user cannot
   perform.

Also corrected: `profiles.available_equipment` exists but is **write-only and
unvalidated** (never read back by any handler; a test writes the string
`"dumbbells"` into a `uuid[]`). `saved_gyms` **supersedes** it rather than
building on it.

## Phased delivery

This triplet covers the whole feature; `tasks.md` sequences it. Each phase is
its own brief and its own PR.

| Phase | Scope                                                                                     | Gated on        |
| ----- | ----------------------------------------------------------------------------------------- | --------------- |
| P0    | `premium_plus` tier restructure (shared prerequisite — build once, here)                  | —               |
| 0     | Data model + saved-gym CRUD + variation endpoints + entitlement guard (backend)           | P0              |
| **E** | **Eval spike, no product code: E1 scan accuracy · E2 re-map engine bake-off**             | 0               |
| 1     | Adaptation engine — **the hybrid, per E2** — + preview endpoint (backend)                 | 0 + E           |
| 2     | Mobile Loadout flow (athlete) **incl. the equipment scan** — entry, collect, review, save | 1 + E + design  |
| 3     | Coach programme-level Loadout + assign                                                    | 2               |
| 4     | Second-engine follow-up (**E2 resolved this — see `tasks.md` Phase 5**)                   | 2 device-verify |

### ⚠ Open sequencing decision (Brad, 2026-07-26) — does the scan still ship inside Phase 2?

The phase table above puts the equipment scan **inside the Phase 2 slice**, decided
2026-07-26 so "the first user-visible Loadout has its hero moment rather than a
checklist". Phase E's split results reopen it, because the two AI surfaces landed
in different places (`design.md` § 1b):

- **The re-map is solid** — D7 decided on evidence, the hybrid measured, costed and
  bounded.
- **The scan is provisional** — 0.966 recall but on 7 photos, 6 of them stock. Its
  real-world rate is unmeasured.

So there is a real choice:

| Option                                                           | For                                                                               | Against                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Keep them together** (as written)                              | The hero moment; one mobile slice, one review                                     | Ships an unvalidated accuracy story on the marquee interaction of a £29.99 tier                   |
| **Split: re-map + saved-gym/manual collect first, scan follows** | Loadout ships on measured ground; scan lands when the real photo set validates it | First release is a checklist, which is the thing the 2026-07-26 re-sequencing was trying to avoid |

**Not decided.** Either way, AC-2.1/AC-2.2 are the floor, not fallbacks, and the
scan needs its own kill switch (`design.md` § 1b).

### Eval spike (Phase E) — why it exists

**The scan is the highest-value and the highest-risk part of Loadout, and it
was originally sequenced last.** It is the only genuinely AI-dependent
component (there is no deterministic way to turn a photo of a gym into an
equipment list), it is what `/pricing` sells at £29.99 — "Scan your gym" — and
**nobody has yet verified that a vision model can identify gym equipment
reliably** from a phone photo: cable stacks, plate-loaded machines,
half-occluded racks, equipment in the background of another machine.

If accuracy is poor, that changes the whole collect step's design. Learning it
after the mobile flow is built around it is the expensive way to find out. So:

- **Phase E runs straight after Phase 0** and ships **no product code** — a
  script, a set of ~30 real gym photos, the seeded `equipment_types` catalogue
  as the candidate list, and a measured hit/miss/false-positive rate per
  equipment category.
- **Exit criteria:** a documented accuracy figure and a go/no-go on
  scan-as-primary. If it underperforms, the manual picklist becomes the
  primary collect path and the scan ships as an accelerator (or not at all)
  — a design decision made on evidence, before Phase 2 commits to it.
- The scan endpoint then ships **inside Phase 2**, so the first user-visible
  Loadout has its hero moment rather than a checklist. It depends only on
  Phase 0's `equipment_types` work, not on the ranker.

### Phase E status (2026-07-26)

- **E2 — COMPLETE.** The hybrid won; D7 above is now decided on evidence.
  Verdict: `scratchpad/loadout-phase-e/VERDICT-E2.md`; summary in `design.md`
  § 6.0; consequences in AC-10.2 / AC-10.3 and `design.md` § 7.3.
- **E1 — RAN, verdict PROVISIONAL.** Brad supplied 7 photos (6 stock, 1 real
  phone photo) rather than the ~30 real ones T-E1.1 asks for, with "this can do
  for now". Result: **0.966 recall at Opus-class, 1.000 on the single real photo,
  3 false positives, zero hallucinated ids** — but stock photography is easy mode,
  so **that is a ceiling, not a real-world rate**. Verdict:
  `scratchpad/loadout-phase-e/VERDICT-E1.md`; summary in `design.md` § 8.0.
  - **Provisional go for scan as a confirmed draft (AC-2.3); NOT yet established
    as the only collect path.** Phase 2 may design for scan; it must not ship it
    as the sole route on 7 photos. The real ~30-photo set is still wanted.
  - **⚠ Two design corrections fell out of it:** the scan model must be
    **Opus-class, not Haiku-class** (Haiku scored half the recall, missed
    `Squat Rack` in 3 of 7 photos, invented 2 ids, and identified only 1 of the 6
    non-catalogue items where Opus identified 5), and `createWithRetry` has
    **effectively no margin** — max 12.27 s end-to-end against its own 12 s
    per-attempt budget. No attempt actually breached it on these 7 easy photos; a
    harder one tips it into a ~22 s retry against a hard 30 s ceiling.

### Phase E has two parts

**E1 — scan accuracy** (above): can a vision model read a gym?

**E2 — re-map quality: deterministic ranker vs AI composition.** Added at
Brad's steer, 2026-07-25. The original D7 picked deterministic on reasoning
alone; that is exactly the kind of call that should be measured, and the
architecture already has the seam for it (`design.md` § 1 stage 2 — SELECTION
is pluggable; stages 1 and 3 are deterministic either way).

The case for AI being **better**, which the eval must test rather than assume:

- **Whole-plan coherence.** The ranker scores each row independently, so it can
  produce five dumbbell presses in a row, or drop every horizontal pull. A
  model sees the whole plan at once.
- **Movement-pattern intent.** A hinge should stay a hinge. Muscle-group
  overlap alone doesn't encode that; a deadlift and a leg extension share
  quads.
- **Graceful degradation.** When no same-muscle candidate exists, the ranker
  returns "unresolved"; a model can restructure the block.
- **Reason copy** people actually read.

The case against, which the eval must price:

- **Latency and cost per adaptation**, and a daily ceiling on a core
  interaction (hitting a cap mid-gym is a bad failure).
- **Programme-level fan-out** — ~48 workouts busts the 30s API Gateway
  ceiling and forces the async-job model (`design.md` § 7.3).

**Hallucination is _not_ a reason to prefer deterministic here.** Under the
candidate-constrained contract (D6) the model selects `exerciseId`s from a
server-built list and any non-member id is a parse failure — it cannot invent
an exercise. That removes the usual objection and is why this is genuinely
worth measuring.

**Method:** a fixed set of ~20 real workouts × 4 equipment contexts (full gym,
dumbbells+bench, bands only, hotel gym). Run both engines over identical
candidate sets. Score blind on a rubric: equipment-legal (hard pass/fail),
muscle/pattern fidelity, plan coherence, reason quality. Record latency and
per-run cost for the AI arm.

**Exit:** a scored comparison and a decision on the v1 engine, plus a
recommendation on the hybrid (deterministic filtering + AI selection + AI
reasons) if it beats both. Phase 1 then builds the winner.

## User stories

### US-1 — Athlete applies Loadout to a workout

As an athlete on Premium+, I can adapt any workout I can open to the equipment
I have today, without changing the original.

- **AC-1.1** A workout detail screen shows a **Loadout** entry card. For a
  Premium+ user it opens the collect step; for anyone else it opens the upsell
  sheet (locked state, never a dead end).
- **AC-1.2** Loadout can be applied to any workout the caller is allowed to
  **read** — their own, a coach-assigned one, or a template. The resulting
  variation is owned by the **caller**, never by the parent's owner.
- **AC-1.3** The parent workout row and its `workout_exercises` are byte-for-byte
  unchanged by any Loadout operation. Asserted by test.
- **AC-1.4** A non-Premium+ caller hitting the create-variation endpoint
  directly gets `402` with `upgradeTo: "premium_plus"` — the gate is
  server-side, not just a hidden button.

### US-2 — Collect the available equipment

As a user mid-flow, I can tell Loadout what kit is available in three ways.

- **AC-2.1 (saved gym)** I can pick one of my saved gyms; its
  `equipment_type_ids` become the equipment context.
- **AC-2.2 (manual)** I can select equipment from a checklist grouped by
  category (free weights / machines / cables / bodyweight / cardio /
  **accessories** — six groups; `design.md` § 2.3b records why bands, ropes and
  the sled needed a sixth), driven by `equipment_types` — no hardcoded
  client-side list. **`equipment_types` has no `category` column today**; adding
  and backfilling it is Phase-0 work, not Phase-2 (`design.md` § 2.3b). An
  uncategorised row renders under "Other".
- **AC-2.3 (scan)** I can photograph the gym; detected equipment is returned as
  a **draft** I confirm or edit before it is used. Detection never writes
  anything on its own. **E1 makes this load-bearing rather than defensive:** at
  Opus-class the scan produced 3 false positives across 7 photos — a pulley-rack
  wall read as a `Cable Machine`, a cross-trainer room read as having a
  `Rowing Machine`, and `Bodyweight` (always true, hence the exclusion below) — so
  the confirm step is what stands between a misread and a wrong adaptation. It also
  sometimes describes a catalogue row in prose rather than selecting its id, so the
  review step must surface null-labelled items prominently enough to add by hand. The scan must also **never return `Bodyweight`** — it is true of
  every gym and is injected server-side (`design.md` § 8.0).
- **AC-2.4** Any collect route can optionally **save the selection as a named
  gym** in the same step (name + save toggle), which creates a `saved_gyms` row.
- **AC-2.5** The equipment context for a run is the confirmed set of
  `equipment_type_id`s. An empty context is rejected (`400`) — adapting to
  nothing is meaningless; bodyweight-only is expressed as the bodyweight
  equipment types.

### US-3 — The plan is re-mapped, targets preserved

- **AC-3.1** Every exercise whose `equipment_required` is satisfied by the
  context is **KEPT** — same exercise, same sets, reps, rest, order, superset
  group.
- **AC-3.2** Every exercise that is not satisfied is **SWAPPED** for the
  best-ranked equipment-compatible alternative, preserving that row's sets,
  reps, rest, position and superset grouping.
- **AC-3.3** Every row carries a **reason**: for a swap, what was unavailable
  and why this alternative was chosen ("No chest-press machine · same muscles,
  uses your dumbbells + bench"); for a kept row, why it survived ("Kept · your
  kit has a cable station").
- **AC-3.4** If no compatible alternative exists for a row, the row is returned
  **unresolved** with an explicit reason — never silently dropped, never
  substituted with something that does not fit the kit. The user can leave it,
  remove it, or pick manually.
- **AC-3.5b (intensity mismatch — added 2026-07-26)** If a row's parent target is
  a **strength range (reps ≤ 6)** and the chosen alternative has lost every
  **loadable** equipment type (barbell, dumbbells, EZ bar, machines, cables, sled
  — ⚠ narrower than the first sketch, which wrongly counted `Kettlebell` and
  `Medicine Ball`; design § 7.1b records the sensitivity test showing the count is
  unchanged either way), the row is returned flagged `intensity_mismatch`
  even though the exercise itself is a valid pattern match. E2 measured this on
  **10 of 171 swaps** — `Barbell Deadlift 4×4-6 → Band Good Morning 4×4-6` — where
  the selection is correct and the prescription is still unusable, because bands
  cannot express that intensity. The check is deterministic: no model, no cost, no
  ceiling. The user can accept it as accessory volume, swap manually, or drop the
  row.
  **Out of scope for v1, and deliberately so:** changing the target to suit the
  kit (4×4-6 → 3×12-15). That would relax `design.md` § 1's rule 2 — targets are a
  database property, never model-authored — and is a **Brad decision with its own
  slice**, not something the ranker may do implicitly (`design.md` § 7.1b).
- **AC-3.5** The adaptation is computed as a **preview**; nothing is persisted
  until the user saves. Abandoning the flow writes nothing.
- **AC-3.6** Candidate exercises are drawn only from exercises the caller is
  allowed to see (the existing `exerciseRepository` visibility predicate) — a
  Loadout swap must never surface another coach's private exercise.

### US-4 — Review and override any pick

- **AC-4.1** The review step lists the adapted plan with per-row SWAPPED / KEPT
  state, the reason line, and a swap affordance.
- **AC-4.2** Opening the swap affordance shows an **equipment-aware picker**:
  ranked "best matches" (compatible with the context, with a match reason)
  above the full library with incompatible options visibly de-emphasised and
  selectable only with an explicit "does not fit your kit" acknowledgement.
- **AC-4.3** A manual pick overrides that row, marks it swapped, and sets the
  reason to a user-chosen attribution.
- **AC-4.4** One shared equipment-aware swap component serves both the Loadout
  review step and the standalone in-session swap action (design D6) — not two
  implementations.

### US-5 — Save as a variation under the parent

- **AC-5.1** Saving creates a new workout owned by the caller with
  `parent_workout_id` = the parent, `variation_kind = 'loadout'`, and
  `source_gym_id` = the saved gym when one was used (null for an ad-hoc
  context), plus the adapted `workout_exercises`.
- **AC-5.2** The variation records the equipment context it was built for and
  the swap count, so the parent's list can describe it without recomputation.
- **AC-5.3** "Save & start" saves the variation and starts a session against it
  in one action.
- **AC-5.4** A variation is a normal workout for every downstream purpose —
  loggable, in history, deletable — except that it is **not** independently
  listed in the owner's main library (it belongs under its parent) and deleting
  the parent does not silently delete it (see `design.md` § 2.2, the
  `ON DELETE SET NULL` rationale).

### US-6 — Variations are grouped under the parent

- **AC-6.1** The parent workout detail lists its variations ("Saved setups"):
  the original as `BASE`, then each variation with gym name, kit summary, swap
  count and age.
- **AC-6.2** `GET` variations-for-a-parent returns only variations the caller
  owns; another user's variation of the same parent is never visible.
- **AC-6.3** Opening a variation shows the adapted plan and can start a session
  from it.
- **AC-6.4** Variations do **not** appear as top-level rows in the owner's main
  workout library — a user with one workout and four Loadout variations sees one
  workout. (`workoutRepository.buildListWhereClause`'s `mine` branch is
  `created_by = userId` with no exclusion today; see `design.md` § Library
  pollution.)

### US-7 — Saved gyms are reusable and manageable

- **AC-7.1** Full CRUD on `saved_gyms`, scoped to the caller: list, create,
  rename, change equipment, delete.
- **AC-7.2** Saved gyms appear in the collect step and in a light list under
  Settings/Profile.
- **AC-7.3** Deleting a gym does not delete variations built from it; the
  variation's `source_gym_id` becomes null and it keeps its stored kit summary.
- **AC-7.4** Gym names are unique per user (case-insensitive, trimmed);
  a duplicate name returns `409`.

### US-8 — Coach adapts a programme for a location

- **AC-8.1** A coach can apply Loadout at **programme** level (every workout in
  the programme adapted for one location) or to a **single workout** inside it.
- **AC-8.2** The result is a programme variation linked to the parent
  programme (`parent_program_id`, `variation_kind`, `source_gym_id`); the
  client's base programme is untouched.
- **AC-8.3** The coach can assign the variant to a client from the review step;
  assignment reuses the existing programme-assignment path unchanged.
- **AC-8.4** A coach may only adapt programmes/workouts they own or are
  permitted to act on, and may only assign to a client with an **active**
  relationship (`assertTrainerCanActForClient`).

### US-9 — Premium+ gate

- **AC-9.1** Loadout endpoints require the `premium_plus` entitlement,
  server-derived from the subscription catalog — never from a client-supplied
  claim.
- **AC-9.2** Trainer tiers get Loadout at their tier's existing AI/feature
  level (they already carry `ai_access`); the exact mapping is set in
  `design.md` § Entitlement.
- **AC-9.3** **No free taster.** There is no lifetime pooled allowance, no
  "3 free runs", no free-tier code path. Comping is done with RevenueCat
  promotional entitlements, which flow through the normal entitlement
  resolution.
- **AC-9.4** A denied caller receives `402` with the upgrade target; the mobile
  surface is the upsell sheet, which states the Premium+ price from the
  catalog (never a hardcoded price literal).

### US-10 — Ceilings on model-backed calls

- **AC-10.1** The equipment-scan endpoint enforces a per-day ceiling following
  the #156 pattern: `429` with `ai_daily_limit`, usage rows written only for
  **actual inferences**, fail-safe env parsing.
- **AC-10.2** ~~The deterministic re-map (D7) has **no** ceiling and writes no
  usage rows — it costs nothing to run.~~ **REVISED 2026-07-26 — D7 resolved to
  the hybrid, so the re-map is model-backed and this AC's premise is gone.** The
  re-map enforces a per-day ceiling on the same #156 pattern as AC-10.1
  (`429 ai_daily_limit`, usage rows for actual inferences only, fail-safe env
  parse). Measured cost is $0.0057 per adaptation — ~$0.51/user/month at three a
  day — so the ceiling is an abuse control, not a unit-economics control.
  ⚠ **Brad checkpoint: the number is undecided and deliberately not proposed
  here.** Hitting a cap mid-gym is a bad failure (§ Eval spike), so this wants a
  deliberate call rather than a default copied from Mealprint.
- **AC-10.3** Programme-level adaptation (US-8) runs as an **async job**, not a
  synchronous request — at 2.60 s per workout the 120-workout cap is ~5 minutes,
  far past the 30 s API Gateway ceiling (`design.md` § 7.3, revised 2026-07-26).
  The job infrastructure is shared with spec-26 Mealprint and must not be built
  twice.

### US-11 — Premium+ exists as a real, purchasable tier (P0)

The tier restructure is a shared prerequisite with spec-26 Mealprint and carries
user-visible behaviour of its own, so it gets its own ACs rather than riding on
US-9.

- **AC-11.1** `premium_plus` exists in the `subscription_tiers` catalog at
  £29.99/mo and £299.99/yr, `is_active`, non-trainer.
- **AC-11.2** The consumer paywall renders a Premium+ card **from the catalog**,
  not from a hardcoded tier name — adding a future consumer tier requires no
  presenter change. Both rails (the live iOS rail and the Stripe rail) behave
  the same.
- **AC-11.3** A RevenueCat entitlement with lookup key `premium_plus` resolves
  to the `premium_plus` tier, and **outranks `premium`** when both are active.
- **AC-11.4** A Premium+ product id maps to the `premium_plus` tier, never to
  `premium` — the substring ladder is ordered correctly.
- **AC-11.5** A Premium+ subscriber is reported as `premium_plus` everywhere
  tier is surfaced — never collapsed to `free` (the `coerceTierName` trap) and
  never rendered as an empty label.
- **AC-11.6** A Premium+ purchase is trial-eligible on the user track, like
  Premium.
- **AC-11.7** Upgrading to Premium+ unblocks queued sync entries that were
  gated on a paid tier (the `USER_TRACK_RANK` trap).

## Non-functional requirements

- **Data isolation.** Every Loadout repository method takes `userId` first and
  every query filters by ownership. Saved gyms, variations and adaptation
  previews are strictly per-user. Coach access is only via
  `assertTrainerCanActForClient`.
- **Migrations** are idempotent, mirror the house style, and are **manually
  applied to production** (staging auto-applies on merge) — flagged in the PR.
- **Coverage** ≥ 90 % on changed files, no fake tests. The real `WHERE` clause
  of every new visibility/ownership query is rendered via `PgDialect` in a test
  (the mocked-`getDb` blind spot).
- **Performance.** Candidate pre-filtering happens in SQL, not in memory over
  the whole library, and must not fan out into per-exercise round trips. A
  programme-level adaptation is explicitly bounded at **120 workouts** — 413
  beyond that, never a silent truncation (`design.md` § 7.3).
- **Offline.** A saved variation is a normal workout and syncs through the
  existing SQLite/queue path; adaptation itself requires connectivity.
- **UI fidelity.** Mobile screens follow the design handoff (D7, with D1 for
  scan and D6 for the swap picker) recreated in the app's existing primitives
  and tokens — no raw hex, no lifted prototype code.

## Non-goals

- Generate-from-scratch workout AI (M19-P2) and program import — separate specs.
- A shared/global gym-equipment database, gym check-in, or location awareness
  (the v2 moat — explicitly not built).
- Sharing saved gyms between users, or a coach reading a client's saved gyms.
- Auto-re-adaptation when a saved gym's equipment changes (variations are
  point-in-time snapshots).
- ~~Model-ranked swaps as the v1 engine (D7) and any async job infrastructure.~~
  **No longer a non-goal (2026-07-26): E2 selected the hybrid, so model selection
  IS the v1 engine and programme-level needs the async job (AC-10.3).** Still a
  non-goal: letting the model choose anything outside the server-built candidate
  list, or touching sets/reps/rest/order.
- Marketing-site copy — the Loadout rename and the £29.99/£299.99 reprice
  already shipped to `packages/web` in PR #311.
- Reviving `profiles.available_equipment` (superseded by `saved_gyms`; left in
  place, still unread).

## Data-isolation acceptance (Dangerous Areas)

- Two-user test: user B cannot read, update or delete user A's saved gyms
  (`404`), cannot list A's variations of a shared/template parent, and cannot
  create a variation attributed to A.
- A variation created from a coach-owned parent is owned by the athlete; the
  coach cannot read it via any variation route.
- After a coach↔client relationship ends (spec 25), the coach cannot adapt or
  assign for that client (`403`).
- Candidate exercises for a swap respect the existing assignment-scoped
  exercise visibility predicate (spec 24) — asserted by a rendered-SQL test.
