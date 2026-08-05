# 22 — Program Import & Adaptation: Requirements

**Authored 2026-08-05.** Combines ROADMAP § 5.3 (AI import of programmes/workouts
from screenshots, photos, links, PDFs) with Loadout **Phase 4** (coach/athlete
programme-level equipment adaptation), which moves here from spec-21 so the two
share one home — **import ingests an external programme; adaptation reshapes it to
the equipment on hand. Import feeds adaptation.**

⚠ **Spec-first, eval-gated.** Per ROADMAP § 5.3 and the M9.5 playbook, **Phase 0 is
an accuracy + cost eval, not code.** No production import path is built until the
eval clears its bar (AC-0.x). This mirrors how Loadout (spec-21) and Snap (M9.5)
were de-risked.

## Why

Two user problems, one pipeline:

1. **"I already follow a programme that isn't in the app."** A premium athlete or a
   coach has a plan as a screenshot, a photo of a whiteboard, a link to a blog/PDF,
   or a coaching-platform export. Re-typing it into the unified Programs model
   (spec-19) by hand is the friction that stops them ever logging against it. This
   is a headline USP alongside the AI client summary.
2. **"The programme assumes a gym I'm not in."** A programme (imported or
   coach-authored) prescribes a barbell back squat; the client is travelling with
   dumbbells only. Today a coach hand-edits per location or the client silently
   drifts. Loadout already solves this for a **single** workout; Phase 4 raises it
   to a **whole programme**.

## Scope

**In:**

- Import a programme from a **URL/link**, an **image** (screenshot/photo), or a
  **PDF**, into editable spec-19 rows the importer owns.
- Deterministic **fuzzy exercise-name → exercise-library resolution**, with a
  find-match-else-create-else-ask boundary — never a silent wrong match.
- A **source-keyed extraction cache** so the same external artifact is extracted by
  AI once, not once per user (efficiency; the biggest AI-cost line here).
- **Programme-level adaptation** (Loadout Phase 4): adapt every distinct workout in
  a programme's cycle to one location, producing a programme variation; cap **10**
  distinct workouts; async job; coach assign.

**Out (parked, named so they are not silently assumed):**

- A **cross-user shared/curated recipe or programme library** with a visibility +
  verification model. Real product value (discovery, sharing) but it carries
  data-quality, allergen/IP-liability and privacy weight that this spec deliberately
  does not take on. See design § 9. The extraction cache here is an efficiency
  mechanism, **not** a shared library — each user still creates their own owned rows.
- Recipe import (spec-16/26) — but the extraction-cache table/service designed here
  is artifact-type-agnostic and that workstream may adopt it (design § 4).
- Generate-a-programme-from-scratch — a different flow (spec-21 D1: Loadout adapts,
  it does not invent).

## Dependencies

- **spec-19** (Programs) — the target model: a programme is an ordered **cycle** of
  `program_workouts`; import produces these rows; adaptation preserves `position`.
- **spec-21** (Loadout) — the single-workout adaptation **engine** (§ 6 ranker, § 7
  save-path re-verify, § 6.1 equipment containment) is reused unchanged; the
  programme-linkage **columns** (§ 2.4) are a shared prerequisite migration.
- **Shipped foundations** — the Bedrock forced-tool-use adapter (M9.5), the
  SSRF-hardened link fetch (`/recipes/import`, `recipes/services/url-fetch.ts`), the
  trigram/FTS exercise search (`GET /exercises/search`), the async-job spine
  (2026-08-03), the `assertEntitlement` catalog-column gate, and the
  `assertTrainerCanActForClient` coach guard.

---

## Acceptance criteria

### US-0 — Eval before build (GATE)

- **AC-0.1** A Phase-0 eval harness scores extraction accuracy on a labelled sample
  of real artifacts across all three input types (URL, image, PDF), reporting
  per-field precision/recall (programme name, days/week, per-workout exercise list,
  sets/reps) and — separately — **exercise-name resolution** accuracy against the
  library.
- **AC-0.2** The eval reports **measured per-import cost** per input type (vision
  tokens dominate image/PDF). No price or ceiling in this spec is quoted from prose;
  all trace to the eval and `scripts/ai-cost-model.ts`.
- **AC-0.3** A written go/no-go with a quality bar agreed by Brad, per input type. A
  type that misses its bar ships disabled, not degraded. (Import that silently
  produces a wrong programme is worse than no import.)

### US-1 — Athlete imports their own programme

- **AC-1.1** A premium athlete can start an import from a **URL**, an **image**, or a
  **PDF**.
- **AC-1.2** Extraction returns an **always-editable draft** — programme name,
  schedule, and an ordered list of workouts each with exercises, sets, reps. Nothing
  is written to the durable model until the athlete accepts (mirrors Loadout and
  Mealprint draft-confirm).
- **AC-1.3** Every extracted exercise name is resolved against the athlete's
  visible catalogue (system ∪ own customs). Each row shows one of: **matched**
  (auto-linked, high confidence), **ambiguous** (a short pick-list the athlete
  chooses from), or **unmatched** (offer: create as a custom exercise, or pick
  manually). ⚠ **No silent wrong match** — an uncertain resolution is surfaced, never
  guessed (contrast `resolveIngredientFood`'s fabricate-on-miss, which this must NOT
  copy).
- **AC-1.4** On accept, the import creates spec-19 rows the athlete owns:
  `workout_programs` + `workouts` + `program_workouts` (cycle order preserved) +
  `workout_exercises`. Newly-created custom exercises are the athlete's own
  (`created_by`), private by default.
- **AC-1.5** The imported programme is immediately loggable and assignable to the
  athlete's own schedule via the existing spec-19 assignment path — no new logging
  surface.

### US-2 — Coach imports a programme for their book

- **AC-2.1** A coach (any trainer tier with the entitlement) can import exactly as an
  athlete does, into programmes they own.
- **AC-2.2** A coach can assign an imported programme to a consenting client via the
  existing assignment path; `assertTrainerCanActForClient` guards every entry point
  (mirrors spec-24/25).

### US-3 — Extraction is not repeated across users (efficiency)

- **AC-3.1** Identical source content is extracted by the model **once**. The cache
  key is a content hash of the fetched/uploaded bytes, so the same artifact dedupes
  regardless of who imports it or which URL it arrived from.
- **AC-3.2** A cache hit still produces the importing user's **own** owned rows
  (copy-on-import). No user can read, enumerate, or be attributed another user's
  import. The cache stores the extracted STRUCTURE, not ownership.
- **AC-3.3** ⚠ **Privacy/IP boundary (Brad checkpoint C1):** cross-user cache reuse
  applies to **public-URL** fetches only (the content is already public). **Uploads
  (image/PDF) cache per-user only** — a user re-importing their own file is deduped,
  but one user's uploaded screenshot of a paid/private programme is never served to
  another. Recommended default; confirm before build.
- **AC-3.4** A resolution (exercise-name → library) is **not** cached cross-user —
  custom catalogues differ per user — only the extraction is.

### US-4 — Coach/athlete adapts a whole programme to a location (Loadout Phase 4)

_Moved from spec-21 US-8; the engine is spec-21's, the orchestration is here._

- **AC-4.1** Loadout can be applied at **programme** level (every workout in the
  cycle adapted for one location) as well as the single-workout level spec-21
  already ships.
- **AC-4.2** The candidate pool is assembled **once** for the union of all muscles
  across the programme's **distinct** cycle workouts, and reused for each — the work
  is linear in distinct workouts, not in occurrences (a 12-week × 4-day programme is
  4 distinct workouts, not 48; spec-19 stores a repeating cycle).
- **AC-4.3** A single programme adaptation is capped at **10 distinct workouts**;
  beyond that the request returns **413** with "adapt in parts", **no silent
  truncation** (spec-21 § 7.3, corrected 2026-08-04 — the cap is per distinct
  cycle-workout, ~8–16 s and ~£0.02–0.035, not the double-counted 120/5-min/£0.69).
- **AC-4.4** Programme adaptation runs as an **async job** (the shared spine), not a
  synchronous request — 10 × ~2.6 s brushes the 30 s API-Gateway ceiling, and the cap
  must never be the thing deciding whether a request survives (spec-21 AC-10.3).
- **AC-4.5** The result is a programme **variation** linked to the parent
  (`parent_program_id`, `variation_kind`, `source_gym_id`,
  `source_equipment_type_ids`); the base programme is never mutated; each adapted
  workout is itself a workout variation with `program_workouts.position` preserved
  (spec-21 § 2.4).
- **AC-4.6** A coach can assign the variant from the review step via the existing
  path; `assertTrainerCanActForClient` guards it, and a coach whose relationship has
  ended (spec-25) gets 403.

### US-5 — Gating and ceilings

- **AC-5.1** Import and adaptation are entitlement-gated. Import: premium_plus for
  athletes and every trainer tier for coaches (mirrors `loadout_access` — premium+
  ∪ all trainer tiers). ⚠ Add the routing line in `assertEntitlement` — a feature key
  without it falls through to `allowed: true` (the documented catch-all trap).
- **AC-5.2** A per-day import ceiling on the #156 fail-safe-parse pattern; the number
  traces to the AC-0.2 cost measurement, not prose. A pooled-budget interaction with
  spec-29 Phase 1 is noted, not pre-decided.
- **AC-5.3** Ceilings and budget count **real inferences only** — a cache hit is not
  an inference and consumes neither the ceiling nor budget.

### US-6 — Safety and correctness

- **AC-6.1** Extraction is **forced-tool-use** with a schema; the model cannot emit
  free-form structure. Sets/reps are validated and clamped to sane bounds; a
  malformed payload is a 422, not a silent partial import.
- **AC-6.2** All model prose that reaches the user (programme/exercise names, notes)
  is length-bounded and rendered as plain text — the same injection posture as
  Mealprint/Loadout (external artifacts are untrusted input on a privileged surface).
- **AC-6.3** The SSRF-hardened fetch is reused for every URL; no import path may fetch
  a private/loopback/link-local address.
- **AC-6.4** Two-user isolation tests on every read/create path; an imported
  programme and its cache entry never leak across users beyond the AC-3.3 boundary.
