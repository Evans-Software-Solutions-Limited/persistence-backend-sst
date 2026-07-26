# Loadout Phase E · E2 verdict — re-map engine bake-off

**Date:** 2026-07-26 · **Task:** `specs/21-adaptive-workout-ai/tasks.md` T-E2.1…T-E2.5
**Decides:** requirements § Decisions **D7** ("re-map engine v1"), which the spec
deliberately left to this eval rather than asserting.

## Verdict

**Phase 1 builds the HYBRID (arm C): deterministic shortlist → model selection →
model reasons.** It is judged-equivalent to the unconstrained model arm, is
materially closer to the deterministic ranker on objective muscle fidelity, and
costs a third as much per adaptation.

**The pure deterministic ranker (arm A) is rejected**, and not marginally — see
§ Why arm A lost. **The pure model arm (arm B) is rejected on cost, not
quality**: it buys nothing the hybrid doesn't already have for 3.4× the spend.

## Method (as specified)

20 workouts × 4 equipment contexts = **80 fixtures, 96 plan rows each pass, 171
rows needing a swap.** Workouts 1–3 are the three real seeded workouts verbatim
(`packages/seed/data/workouts.json`); 4–20 are ordinary training templates
composed only from names that exist in the seeded 2281-row catalogue — every one
validated at load time, so no fixture can silently shrink.

Stage 1 (candidate assembly) and stage 3 (verification) are shared and
deterministic, exactly as `design.md` § 1 requires. Arms A and B receive an
**identical** candidate set per fixture; arm C's narrower set is the hybrid's
whole hypothesis, not an unfair advantage, and arm C is still **verified against
the full pool**.

| Arm | Stage 2 (SELECTION)                                                                   | Model     |
| --- | ------------------------------------------------------------------------------------- | --------- |
| A   | `design.md` § 6.2 scoring as a pure function, greedy no-duplicate pick                | none      |
| B   | forced tool use, whole plan in one call, ids from the full pool (mean 303 candidates) | Haiku 4.5 |
| C   | same call, ids from a § 6.2-ranked top-25-per-row shortlist (mean 56 candidates)      | Haiku 4.5 |

Blind scoring: the two plans are anonymised as "Plan One"/"Plan Two" with
presentation order set by an FNV-1a hash of the fixture key — stable across
re-runs, and varying per fixture so a first-position bias cannot systematically
favour one arm. **Position bias was checked and is absent:** arm B won 27/31 when
presented first and 25/26 when presented second. Judge is Opus 4.6, a different
model from the arms under test.

## Results

### Objective (programmatic, all 80 fixtures)

| Metric                                | Arm A     | Arm B     | Arm C     |
| ------------------------------------- | --------- | --------- | --------- |
| **Equipment-legal plans (hard gate)** | **80/80** | **80/80** | **80/80** |
| Hallucinated / non-member ids         | 0         | 0         | 0         |
| Mean primary-muscle fidelity          | **0.977** | 0.871     | 0.949     |
| Unresolved rows                       | 0         | 1         | 0         |
| Duplicate picks within a plan         | 0         | 0         | 0         |
| Near-duplicate pairs                  | **5**     | 11        | 8         |
| Plans dropping a parent muscle        | **16**    | 28        | 23        |

### Judged (blind, 58 fixtures — 22 skipped as byte-identical)

| Axis                 | A vs B |          | C vs B   |      | A vs C |          |
| -------------------- | ------ | -------- | -------- | ---- | ------ | -------- |
|                      | A      | B        | C        | B    | A      | C        |
| Pattern fidelity     | 3.07   | **4.43** | 4.07     | 4.17 | 2.98   | **4.28** |
| Whole-plan coherence | 3.21   | **4.10** | **3.93** | 3.90 | 3.16   | **4.07** |
| Reason quality       | 2.62   | **4.02** | **3.81** | 3.74 | 2.69   | **4.07** |
| Preferred            | 5      | **52**   | 25       | 25   | 4      | **50**   |
| Ties                 | 1      |          | 8        |      | 4      |          |

Arm A scored 3.07/3.21/2.62 and 2.98/3.16/2.69 in two independent judge runs, and
arm C 4.07–4.28 / 3.93–4.07 / 3.81–4.07. That agreement across separate runs is
the reliability evidence for the scale.

### Latency and cost (60 swap-bearing fixtures; `ess-dev`, eu-west-2)

|                         | Arm A  | Arm B                    | Arm C                    |
| ----------------------- | ------ | ------------------------ | ------------------------ |
| p50 / p90 / max latency | 0.1 ms | 2.84 s / 3.69 s / 4.07 s | 2.55 s / 3.66 s / 3.79 s |
| Mean input tokens       | —      | 18,140                   | **4,436**                |
| **Cost per adaptation** | **$0** | $0.0193                  | **$0.0056**              |
| Worst observed run      | $0     | $0.0265                  | $0.0092                  |

Cost uses Anthropic list rates for Haiku 4.5 ($1/$5 per MTok). **Bedrock is
partner-priced and may differ — confirm against the AWS bill before this becomes
a pricing commitment.**

## Why arm A lost

Its § 6.2 scoring is dominated by primary-muscle overlap, so it maximises exactly
the metric it wins on and is blind to movement pattern. Real fixture output:

| Parent row                           | Arm A picked                                   | Arm C picked                |
| ------------------------------------ | ---------------------------------------------- | --------------------------- |
| Barbell Deadlift (bands only)        | **Atlas Stones**                               | Band Good Morning           |
| Machine Bicep Curl (bands only)      | **Floor Rope Climb**                           | Standing Band Biceps Curl   |
| Machine Lateral Raise (bands only)   | Back Flyes with Bands (rear delt, not lateral) | Band Lateral Raise          |
| Barbell Back Squat (dumbbells+bench) | Dumbbell Lunges (bilateral → unilateral)       | Dumbbell Front Squat        |
| Hanging Leg Raise (bands only)       | Holman Boat Pull-Over                          | Alternating Lying Leg Raise |

These are not near-misses. "Atlas Stones" in a hotel room with a resistance band
is the kind of output that makes a £29.99/mo feature unshippable, and it is
_equipment-legal_ — which is precisely why the hard gate passing 80/80 for every
arm does not settle the question.

**The structural reason matters more than the examples.** § 6.2 gives 10 points
for matching `movement_type`, and **`movement_type` is NULL for all 2281 seeded
rows** — it is only ever written by `exercisesCreateHandler` /
`exercisesUpdateHandler` for user-created exercises. The signal degrades to
`category`, which is `strength` for 1976/2281 rows, so pattern awareness is
effectively absent from the ranker's inputs. A deterministic arm could only close
this gap by **backfilling `movement_type` across the catalogue first** — a data
workstream in its own right, not a Phase-1 task. Arm A lost on the data the
library actually has, and that is the decision-relevant fact.

## Why the hybrid beats the pure model arm

Against arm B the hybrid is a dead heat on judgment (25–25 with 8 ties, and
within ±0.1 on two of three axes) while being **71 % cheaper** and **+0.078
better on muscle fidelity**. Narrowing 303 candidates to 56 removes the long tail
of exotic library rows the model can wander into without removing the pattern
sense that is the model's actual contribution. It also keeps the § 6.2 ranker in
Phase 1's scope (**T-1.2 stays**) — as a shortlister, which is what it is good
at, rather than as the chooser.

## What Phase 1 inherits because a model is now in the path

Stated explicitly, as T-E2.5 requires. All four are consequences of the verdict,
not of the eval.

1. **A daily ceiling, and an AC that is now wrong.** **`AC-10.2` currently reads
   "The deterministic re-map (D7) has no ceiling and writes no usage rows — it
   costs nothing to run." That is no longer true and must be rewritten.** The
   re-map needs the #156 pattern: `429 ai_daily_limit`, usage rows for actual
   inferences only, fail-safe env parse.
   ⚠ **Brad checkpoint — a ceiling number is not proposed here.** Hitting a cap
   mid-gym is the bad failure requirements § Eval spike already flags, and the
   cost line below suggests the cap exists for abuse control rather than unit
   economics.
2. **A cost line.** $0.0056 per adaptation. Three adaptations a day is
   **~$0.50/user/month** against £29.99 — negligible. Even a 20/day ceiling
   fully consumed is ~$3.36/month.
3. **Programme-level fan-out must go async.** At 2.55 s p50 per workout, the
   120-workout cap is ~5 minutes of model time; even a 12-week × 4-session
   programme (~48 workouts) is ~2 minutes. **The 30 s API Gateway ceiling that
   `design.md` § 7.3 says "does not bind here" now binds** — Phase 4 needs the
   async-job model. Single-workout Loadout is unaffected (max observed 4.07 s,
   comfortably inside the ceiling, and inside `createWithRetry`'s 12 s × 2).
4. **That async-job infrastructure is shared with spec-26 Mealprint** (week
   plans, programme import). **It must not be built twice** — whichever spec
   reaches it first builds it and the other consumes it.

Also carried forward: `design.md` § 7.2's structured reason codes are **not
sufficient on their own** if the model writes the reason. Arm C's reason copy
scored well but reads formulaically ("X replaces the Y with a…"). Phase 1 should
return the structured code **and** the model's sentence, and Phase 2 owns the
copy treatment.

## Findings that are not about either arm

1. **`Leg Press` and `Leg Curl` pass every equipment context — a live data bug.**
   Their seeded `equipmentRequired` names (`"Leg Press"`, `"Leg Curl"`) have no
   `equipment_types` row (the rows are `Leg Press Machine` / `Leg Curl Machine`),
   and `seedExercises.ts`'s `resolve()` **silently drops** unmapped names. Both
   rows end up `equipment_required = '{}'`, and `@> '{}'` is always true, so a
   bands-only athlete **keeps the leg press**. It affects the seeded "Lower Body"
   and "Full Body Starter" workouts — the first two workouts a new account owns.
   The blind judge flagged it unprompted on both arms ("Both plans erroneously
   keep Leg Curl and Leg Press despite those machines being unavailable"). A
   third row, `Wall Shoulder Tap`, loses `"Wall"` but keeps `Bodyweight`, so it is
   harmless. **Fix is a data migration plus a seeder guard that fails loudly on
   an unmapped equipment name; it is not an engine change and not in Phase 1's
   critical path.**
2. **The `full_gym` context produced zero swaps across all 96 rows.** It is a
   pure control — it proves the KEPT/needs-swap partition works and that neither
   arm churns a plan it was told to leave alone (arm B answered for a fixed row
   once in 80 runs; stage 3 discarded it). It contributes nothing to the quality
   comparison, which is why 22 fixtures were byte-identical and excluded from
   judging.
3. **The `LIMIT 400` cap truncated 28 of 80 candidate pools.** Real behaviour at
   Loadout's scale, not a fixture artefact — `design.md` § 6.3's "log on
   truncation" is load-bearing, and the hybrid's shortlist makes the cap far less
   consequential.
4. **Bedrock model access held.** Haiku 4.5 and Opus 4.6 both verified callable
   in `ess-dev`/eu-west-2 before the run. Haiku 4.5 is granted in **both**
   accounts, so the re-map has no production grant blocker — but per the
   2026-07-26 outage lesson, **re-verify per account before shipping**, and never
   use a `global.` inference profile.

## Limitations of this eval

- **Visibility is untested.** Every seeded row is `is_public = true` and owned by
  the system user, so stage 1's `buildVisibilityCondition` is a no-op across this
  corpus. AC-3.6 still needs its own `PgDialect` test in Phase 1.
- **The "logged before" (+8) signal is a proxy.** With no session history
  offline, every exercise appearing in the 20 fixture workouts counted as
  previously trained. Production reads real history.
- **Arm A is a throwaway prototype**, as T-E2.2 specifies. Two § 6.2
  interpretation choices are documented in `src/armA.ts` (proportional rather
  than binary overlap; `category` standing in for the absent `movement_type`).
  Neither favours arm C — proportional overlap makes arm A score _better_ on the
  metric it wins.
- **One judge model, one arm-B model.** Opus 4.6 judging Haiku 4.5 avoids
  self-preference in the primary comparison, but a second judge would harden the
  1–5 scales. The hard metrics and the worked examples above do not depend on the
  judge.
- **Cost is list-rate arithmetic**, not a measured AWS bill.
