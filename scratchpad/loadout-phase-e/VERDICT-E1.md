# Loadout Phase E · E1 verdict — can a vision model read a gym?

**Date:** 2026-07-26 · **Task:** `tasks.md` T-E1.1…T-E1.4
**Status: PROVISIONAL.** The dataset is **7 photos, 6 of them stock**, not the ~30
real ones T-E1.1 specifies. Brad supplied it with "this can do for now".

## Read this before quoting any number below

Stock gym photography is **easy mode**: staged, wide-angle, evenly lit, nothing
occluded, no clutter. That is the opposite of what E1 exists to measure — the
half-occluded rack, the cable stack in shadow, the phone held at chest height in a
cramped garage. So:

- **The headline recall is a CEILING, not a real-world rate.** It says the task is
  tractable; it does not say what a user's photo will score.
- **One photo (`photo01`) is a genuine phone photo** — a real garage gym, angled,
  cluttered, with a road bike and a stability ball in frame. It is reported
  separately throughout, and it is the only number with real-world standing. n=1.
- Ground truth is **Claude's own labelling**, written before any model ran and
  committed in `src/e1Fixtures.ts` so it is auditable. Not Brad-confirmed.

**This verdict does not discharge the go/no-go on scan-as-primary.** It moves it
from "unknown, possibly hopeless" to "likely viable, needs a real dataset to
confirm". Phase 2 can now design _for_ scan; it should not ship it as the only
collect path on this evidence.

## Results (7 photos, 29 ground-truth items)

|                                                                | **Opus 4.6**            | Haiku 4.5         |
| -------------------------------------------------------------- | ----------------------- | ----------------- |
| Recall                                                         | **0.966** (28/29)       | 0.759 (22/29)     |
| **Recall on the one real phone photo**                         | **1.000** (6/6)         | 0.500 (3/6)       |
| False positives (7 photos)                                     | **3**                   | 7                 |
| Look-alike traps tripped                                       | 2                       | 3                 |
| **Non-member ids returned**                                    | **0**                   | **2**             |
| **Non-catalogue items correctly identified** (of 6)            | **5**                   | 1                 |
| Described a catalogue row in prose instead of selecting its id | 3                       | 2                 |
| Null-id entries that are neither (clock, mirror, gym bag)      | 15                      | 0                 |
| Mean latency                                                   | 10.1 s (max **12.3 s**) | 4.3 s (max 4.7 s) |
| Cost per scan                                                  | $0.0272                 | $0.0051           |

Scoring: an `ambiguous` detection (a bar whose type is unreadable, a dark tower
that may be a cable stack) counts as neither hit nor false positive — the model
is not punished for a judgement call the labeller could not make either. 7 such
detections for Opus.

## Verdict

**1. Scan is viable — provisionally, and only at Opus-class.** 0.966 recall with 3
false positives across 7 photos, and a clean sweep of the one real phone photo, is
comfortably good enough for a **draft the user confirms** (AC-2.3). It is not good
enough to write equipment without confirmation, and the design already never does.

**2. ⚠ Design § 8's model choice is WRONG and must change.** It says
"`AI_EQUIPMENT_SCAN_MODEL_ID`, vision-capable, **Haiku-class first** (the task is
far simpler than food estimation)". Measured, the task is **harder**, not simpler:

- Haiku missed **`Squat Rack` in 3 of 7 photos** — the single most load-bearing
  item for a home-gym user. If the rack is missed, every barbell lift in the plan
  gets swapped out for no reason.
- Haiku fell for the planted road-bike look-alike **in the real photo**
  (`Exercise Bike`), and for rubber floor tiles as a `Yoga Mat` on a stock garage
  shot — two of its three tripped traps. Opus tripped neither of those.
- Haiku returned **2 non-member ids** — 422s in production. Opus returned none.
- **Haiku identified 1 of the 6 genuinely non-catalogue items; Opus identified 5.**
  That is the `null` + label escape hatch working (design § 1): a punch bag, a
  strongman log and a stability ball have no `equipment_types` row, and the right
  answer is to say so rather than force the nearest match.

Half the recall, twice the false positives, it invents ids, and it recognises
one-fifth as many out-of-catalogue items. **Use the Opus-class id** (`eu.anthropic.claude-opus-4-6-v1`, already the prod photo model
for Snap AI) and note that this is the reverse of the food-estimation split, where
text estimation runs on Haiku.

**3. ⚠ `createWithRetry` has effectively no margin for the scan.** Design § 8 says
"12 s × 2 fits the 30 s API Gateway ceiling". Measured Opus latency is **mean
10.1 s, max 12.27 s end-to-end against a 12 s per-attempt budget.**

Precisely, because the distinction matters: **no attempt actually breached the
timeout** — all 7 calls returned successfully, and a breach would have produced a
~22 s retry. The 266 ms of overshoot is outside the SDK's timed window (`latencyMs`
brackets `createWithRetry`, so it includes base64 serialisation and SigV4 signing
over a ~1.5 MB image). So the honest reading is **not** "the timeout is exceeded"
but "the slowest observed scan finished within ~0 % margin of it, on 7 easy
photos". A harder photo, a colder Lambda or a slower region tips it over, and the
cost of tipping over is a full retry: ~22 s plus auth, entitlement, ceiling-check
and usage-log overhead against a hard 30 s.

This is the same question already moved to T-1.9 for the re-map, and E1 answers it
for the scan: **the scan needs either a raised per-attempt timeout with a single
attempt (~20 s, which is exactly what GTM § 3 P2 asked for), or a smaller image.**
Note the input was 1568 px long-edge at ~3000 tokens; prod food photos run at
640 px. Downscaling would cut latency and cost, at unmeasured accuracy cost —
**that trade is worth measuring on the real dataset**, not guessed at now.

**4. Ceiling and cost.** $0.0272 per scan at Opus-class — **~5× the re-map's
$0.0057**. At the proposed 10/day that is a $8.16/user/month worst case, which is
material against £29.99 in a way the re-map's ceiling is not. Still a Brad
checkpoint; this is the first number that argues the scan ceiling actually needs
to be low, and it argues for measuring the 640 px option before launch.

## What the false positives were

Opus's 3, all defensible-but-wrong: a `Cable Machine` on the brick-garage photo
(there is a wall-mounted rack with pulleys — arguably right, I labelled it a
trap), a `Rowing Machine` in the cardio room (there is a cross-trainer and a
treadmill; no rower), and `Bodyweight` on the staged photo — which is _technically
always true_ and suggests the catalogue's `Bodyweight` row should be filtered out
of scan results entirely rather than treated as detectable.

That last one is a small, real design note for T-3.3: **exclude `Bodyweight` from
what the scan may return** (it is a property of every gym, not a piece of kit) and
inject it into the context server-side instead.

**A second prompt note, and both models do it: describing a catalogue row in prose
instead of selecting its id.** Haiku returned "Cable machine or functional trainer"
and "Medicine ball or wall ball" as `null` + label on a photo where both _are_
catalogue rows; Opus did the equivalent 3 times ("Dumbbell Storage Rack"). It is
the mirror image of forcing a match, and it costs the user real kit. T-3.3's prompt
should push harder on "if it IS in the list, use the id — `null` is only for things
the list does not contain", and the review step should surface null-labelled items
prominently enough that the user can add them by hand.

**Opus is also chatty in a way that matters for the UI:** 15 of its null-id entries
were neither equipment nor out-of-catalogue kit — a wall clock, a mirror, a gym
bag, plants. Harmless to the equipment context (they carry no id) but the confirm
sheet must not show them as suggestions.

## Reproducing these numbers

`bun scratchpad/loadout-phase-e/src/e1Resummarise.ts` — free, offline, no Bedrock;
recomputes every figure above from the committed `results/e1-*.json`, including the
cost line. `e1Scan.ts` now emits the same fields directly on a fresh run.

## Exit criteria, against `requirements.md` § Eval spike

| Criterion                    | Status                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A documented accuracy figure | ✅ 0.966 ceiling / 1.000 on n=1 real                                                                                                                                                                                                  |
| Go/no-go on scan-as-primary  | ⚠ **Provisional go as an accelerator; not yet as the only path.** Needs the real ~30-photo set.                                                                                                                                       |
| Which categories fail        | ⚠ Partially. Free weights and cardio read cleanly; the hard cases (plate-loaded, cable stacks) landed in `ambiguous` because _I_ could not label them confidently from stock photos — which is itself a sign the dataset is too easy. |

## What would make this a real verdict

~30 photos taken **the way users will take them**: phone, in the room, not stepped
back, including a busy commercial floor with equipment behind equipment, a hotel
gym at night, and a bands-only corner of a bedroom. Then re-run
`bun scratchpad/loadout-phase-e/src/e1Scan.ts --model=opus` with ground truth
labelled by Brad rather than by me, and measure the 640 px vs 1568 px trade.
