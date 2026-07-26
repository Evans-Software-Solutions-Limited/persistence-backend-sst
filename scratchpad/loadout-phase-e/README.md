# Loadout Phase E — eval spike (throwaway)

Scratchpad, not production code. **Nothing here may move into `src/`** — see
`specs/21-adaptive-workout-ai/tasks.md` T-E.9. It is committed because it is the
evidence behind a decision (D7) that would otherwise be an assertion.

- **E2 — re-map engine bake-off: DONE.** Verdict in [`VERDICT-E2.md`](./VERDICT-E2.md).
- **E1 — scan accuracy: BLOCKED**, awaiting ~30 real gym photos from Brad
  (T-E1.1). Deliberately not started: the point of E1 is measuring real-world
  accuracy, so stock images would produce a number that means nothing.

## Running it

Requires the `ess-dev` AWS profile for the Bedrock stages. **Never `ess-prod`** —
model grants are per-account (STATE.md 2026-07-26), and this is an offline eval
with no business touching production.

```bash
# Stage 1 only — no model calls, no cost. Prints fixture + candidate-pool stats.
bun scratchpad/loadout-phase-e/src/run.ts --stage=candidates

# Arm A — deterministic ranker (design § 6.2 prototyped as a pure function).
bun scratchpad/loadout-phase-e/src/run.ts --stage=a

# Arm B — model over the full candidate pool.        ~$1.19 for 80 fixtures
AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 \
  bun scratchpad/loadout-phase-e/src/run.ts --stage=b --model=haiku

# Arm C — hybrid: § 6.2-ranked shortlist, then model. ~$0.37 for 80 fixtures
AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 \
  bun scratchpad/loadout-phase-e/src/run.ts --stage=c --model=haiku --perRow=25

# Blind judge, any two arms. Skips fixtures where both arms agree byte-for-byte.
AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 \
  bun scratchpad/loadout-phase-e/src/run.ts --stage=judge --left=armA --right=armC-haiku

# Aggregate whatever is in results/.
bun scratchpad/loadout-phase-e/src/run.ts --stage=report --model=haiku \
  --judges=judge-armA-vs-armB-haiku,judge-armC-haiku-vs-armB-haiku,judge-armA-vs-armC-haiku

# Recompute EVERY figure the verdict quotes, from committed results. Free, offline.
bun scratchpad/loadout-phase-e/src/resummarise.ts
```

The model stages refuse to run unless `AWS_PROFILE=ess-dev` and the model id is an
`eu.*` inference profile (`assertDevEnvironment`) — `getDefaultClient()` inherits
whatever the shell exports, so the guard is code rather than a comment.

`--model=opus` switches to Opus 4.6 (also granted in `ess-dev`). Not used for the
verdict: Haiku 4.5 already won the judged axes, and Opus 4.6 is the judge, so an
Opus arm would introduce self-preference into the primary comparison.

## Layout

| File                 | Role                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/library.ts`     | The seeded 2281-row catalogue, resolved with the seeder's own drop-unmapped-equipment semantics. Containment predicate (`design.md` § 6.1). |
| `src/fixtures.ts`    | T-E2.1 — 20 workouts × 4 contexts. Every exercise name must resolve or the run hard-fails.                                                  |
| `src/pipeline.ts`    | The deterministic stages both arms share: partition, candidate assembly (§ 6.3), verification (§ 1 stage 3).                                |
| `src/armA.ts`        | T-E2.2 — § 6.2 scoring prototype, plus the hybrid's shortlister.                                                                            |
| `src/armB.ts`        | T-E2.3 — forced-tool composition over the M9.5 Bedrock harness.                                                                             |
| `src/metrics.ts`     | T-E2.4, objective half. `equipmentLegal` is the hard pass/fail.                                                                             |
| `src/judge.ts`       | T-E2.4, judged half. Blind, anonymised, hash-ordered.                                                                                       |
| `src/run.ts`         | Stage runner.                                                                                                                               |
| `src/resummarise.ts` | Recomputes every verdict figure from committed `results/`, with the corrected metric definitions. Free, offline, no Bedrock.                |
| `results/*.json`     | The dataset the verdict cites. Committed — regenerating the model stages costs money and would not reproduce byte-for-byte.                 |

The Bedrock client, retry policy and tool-use parsing are imported from
`microservices/core/.../aiBedrockClient.ts` rather than reimplemented — that
reuse is also what resolves `@anthropic-ai/bedrock-sdk`, which is a dependency of
`microservices/core`, not of the repo root. `createWithRetry`'s 12 s × 2 budget is
sized for the 30 s API Gateway ceiling and is irrelevant offline; it is left
alone on purpose.

## Corrections after the Inspector Brad sweep

Two metric defects were found **after** the model stages had run, so the committed
`results/*.json` were produced by the pre-fix revision of `metrics.ts`:

1. `muscleFidelity` returned a fiat `1` on the 22 zero-swap fixtures and was
   averaged over all 80 — a value that cannot fail, compressing every arm's gap.
   Now `null`, and averaged over swap-bearing plans only.
2. `nearDuplicatePairs` used an asymmetric `i ⊆ j` subset test, so detection
   depended on which row a pick landed on. Now symmetric (this moved arm B from
   11 to 13).

Rather than re-spend ~$1.50 of Bedrock to regenerate the dataset,
`resummarise.ts` recomputes the affected figures from what is committed — the
per-fixture data it needs is all there, and near-duplicates are re-derived from
the picks parsed back out of each rendered plan. **The verdict quotes
`resummarise.ts`'s output, not the `summary` blocks inside the arm files**, which
still carry the pre-fix aggregates. A future re-run of `--stage=a/b/c` will emit
corrected summaries directly.

Also note `results/judge-armA-vs-armB-haiku.json` predates the generalised
`--left`/`--right` judge stage: its summary uses `preferredArmA`/`preferredArmB`
and omits `left`/`right`/`judgeModel`. The measurement is unaffected — its
`armAFirst` flags all match the committed `fnv1a(key) % 2 === 0` blinding — but
re-running that comparison will overwrite it with a different-shaped summary.

## Determinism

Arm A and both deterministic stages are fully reproducible. No `Math.random`
anywhere — blind judge ordering comes from an FNV-1a hash of the fixture key. The
model stages are not reproducible (no temperature control on this path), which is
why `results/` is committed rather than regenerated on demand.
