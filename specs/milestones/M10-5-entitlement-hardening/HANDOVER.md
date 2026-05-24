# M10.5 Wave 1 — Handover

PR #72 closed Inspector Brad on sweep #3 (case closed). Ready to merge. This doc captures everything the next operator (AI agent or human) needs to pick up M10.5 Wave 2 + M10.6 without re-deriving from PR conversation history.

## What just landed

PR #72 — `feat(M10.5): entitlement hardening + feature-gate primitives + offline UX (Wave 1)`.

**Backend:**

- `assertEntitlement(userId, feature)` helper at `microservices/core/src/application/entitlement/assertEntitlement.ts`. Reads live DB; never JWT-only. Returns structured verdict; `EntitlementError` throws → 402 with the documented body.
- Helper is wired into `POST /workouts` and `POST /sessions/record` (fresh-workout path + non-owned-workout path).
- 4 stub features today: `ai_workout`, `gym_buddy`, `unlimited_exercise_library`, `trainer_clients` — all return `{ allowed: true }` until their consuming endpoints ship.
- Errors closed during Inspector Brad's review:
  - Month-rollover lock-out (added `gte(resetDate, currentMonthStartUtc())` filter).
  - Entitlement bypass via non-owned `workoutId` (added ownership check via `WorkoutRepository.getById` + `createdBy === userId`).
  - Latent typebox/Elysia version drift fixed via root `overrides` block (`@sinclair/typebox: ^0.34.0`, `react-dom: 19.2.0`).

**Mobile:**

- Feature-gate primitives: `useFeatureGate(feature)` hook, `FeatureGatePrompt` component, `SubscriptionBadge` component, `SSTApiAdapter` 402 interception.
- Offline UX: `useOnlineStatus()` hook, `NetInfoPort` + adapters, offline banner on the two subscription screens, mutation pre-flight, slow-network "still working…" indicator, 3DS network-drop recovery.
- Errors closed during Inspector Brad's review:
  - `useOnlineStatus` probe-vs-subscribe race (added `subscribeFired` guard).
  - `useFeatureGate` no-op ternaries dropped.
  - `useFeatureGate` cancelled-but-paid-through divergence with server (added `isExpiresAtInFuture` helper).

**Test deltas:** core 799 → 890 (+91), mobile 1647 → 1732 (+85), scripts unchanged.

**All gates green.** Prettier ✓ · typecheck 7/7 ✓ · lint 0 errors ✓ · build 12/12 ✓ · all 4 test suites green.

## Pre-merge checklist (do before clicking Merge on PR #72)

- [ ] Inspector Brad case-closed status confirmed on the PR (no open findings)
- [ ] CI green on the latest commit (`gh pr checks 72`)
- [ ] Spot-check the diff one more time at https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/72/files

## Merge action

Standard merge via GitHub UI. **Auto-fires on push to main:**

- `deploy-staging.yml` — deploys backend to `api.staging.persistence.evans-software-solutions.com`. ~6 min.
- `release-please.yml` — opens / updates the release PR.

**Mobile is NOT auto-deployed.** EAS build workflows are intentionally commented out per Brad's build-budget note.

## Post-merge verification (~5 min)

1. Watch the staging deploy run: `gh run list --workflow=deploy-staging.yml --limit 1`. Should complete green in ~6 min.
2. Hit the new endpoints unauthenticated to confirm they exist:

```bash
curl -sS -o /tmp/t.json -w "HTTP %{http_code}\n" https://api.staging.persistence.evans-software-solutions.com/subscription-tiers
# Expect: HTTP 200 with { "data": [...] }

curl -sS -o /tmp/m.json -w "HTTP %{http_code}\n" https://api.staging.persistence.evans-software-solutions.com/subscriptions/me
# Expect: HTTP 401 (auth required); confirms the route exists
```

3. (Optional) Walk through [SMOKE_TEST.md](./SMOKE_TEST.md) — 10 e2e steps incl. the JWT-only-trust regression check (Step 10).

## Next work — what to spawn after merge

Briefs are **already committed on this branch** (will be on `main` post-merge). Two independent pieces of work can spawn in parallel.

### M10.5 Wave 2 — per-screen feature-gate integration (3 parallel agents)

Wires `useFeatureGate` + `FeatureGatePrompt` + `SubscriptionBadge` into specific screens. Three disjoint trees, fully parallelisable.

| Agent                 | Brief                                                              | Scope                                                                                                                          |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `m105-gates-workouts` | [WAVE_2_GATES_WORKOUTS_BRIEF.md](./WAVE_2_GATES_WORKOUTS_BRIEF.md) | Exercise creator, workout creator (AI option gate), session start, workout-limit warning at limit-3 / hard gate at limit-equal |
| `m105-gates-progress` | [WAVE_2_GATES_PROGRESS_BRIEF.md](./WAVE_2_GATES_PROGRESS_BRIEF.md) | Progress tab analytics, Health tiles, Profile `SubscriptionBadge` placement                                                    |
| `m105-gates-trainer`  | [WAVE_2_GATES_TRAINER_BRIEF.md](./WAVE_2_GATES_TRAINER_BRIEF.md)   | Clients tab route stub + tab-bar visibility gate (M8 owns real client management)                                              |

**Overview:** [WAVE_2_BRIEF.md](./WAVE_2_BRIEF.md). **Smoke test:** [WAVE_2_SMOKE_TEST.md](./WAVE_2_SMOKE_TEST.md).

### M10.6 — sync-queue entitlement re-check (1 agent)

Closes the offline-then-flush abuse vector. Mobile sync engine catches 402 + ENTITLEMENT_DENIED on flushed entries, marks them `blocked_entitlement`, surfaces banner + review screen + auto-retry on tier upgrade. Backend is unchanged (M10.5 Wave 1's `assertEntitlement` already returns the right shape).

- Overview: [`../M10-6-sync-queue-entitlement/BRIEF.md`](../M10-6-sync-queue-entitlement/BRIEF.md)
- Agent brief: [`../M10-6-sync-queue-entitlement/MOBILE_BRIEF.md`](../M10-6-sync-queue-entitlement/MOBILE_BRIEF.md)
- Smoke test: [`../M10-6-sync-queue-entitlement/SMOKE_TEST.md`](../M10-6-sync-queue-entitlement/SMOKE_TEST.md)

**M10.6 is independent of M10.5 Wave 2** — both can spawn in parallel for maximum throughput. 4 agents in parallel total.

### Orchestration cheat-sheet (lessons from this run)

1. **Commit briefs BEFORE spawning.** M10 had a base-mismatch bug because agents forked off uncommitted briefs. M10.5 Wave 1 fixed this by committing both `2e9662d` (spec extension) + `5cec945` (briefs) before any agent ran.
2. **Use `isolation: "worktree"` for every agent.** Each agent's worktree is isolated; no file conflicts between parallel agents on disjoint scopes.
3. **Run agents in background** (`run_in_background: true`). Get auto-notified on completion; don't poll the JSONL transcript files — they overflow context.
4. **Each agent must commit + NOT push** — the orchestrator merges branches into the milestone PR branch.
5. **Run the full gate after EACH agent's merge.** Lessons from this run: turbo cache + lockfile drift can surface latent errors. Re-running `bun install` after every merge is cheap insurance.
6. **Web workspace tests are easy to miss locally.** `bun --filter @persistence/web test:unit` — don't forget it; CI catches it but local iteration is slower.
7. **Bun's `--frozen-lockfile` is the CI install command.** Re-run `bun install` without the flag locally, then commit the lockfile delta. Drift here was the cause of one full CI re-run during M10.5.
8. **Bun, not npm. Throughout.**

## Spec amendments flagged by the M10.5 Wave 1 backend agent (not blockers, queue for cleanup)

Three small docs items the backend agent flagged during Wave 1. None are runtime issues — implementation is correct; only the spec text drifts. Can fold into Wave 2 work or ship as a tiny standalone docs PR.

1. **`subscription_limits.limit_type = 'workouts'`** in the live DB, not `'workouts_per_month'` as the spec said. Implementation matches DB. Spec text needs update at `specs/11-payments-subscriptions/design.md` § Entitlement enforcement.
2. **402 example body uses stale pricing.** `design.md` example shows `upgrade_to: "premium"` + `upgrade_price_monthly: 14.99`. Live seed: premium £12.99, `individual_trainer_pro` £14.99. Runtime reads catalog so behaviour is correct; only the doc example drifts.
3. **Session-record gate is policy-on-top, not DB-derived.** The trigger only fires on `workouts` inserts; `workout_sessions` inserts don't increment the count. Make the policy explicit in spec rather than implied.

## Operational follow-ups (parked, low priority, not blocking M10.6)

- **Helper unification** — extract `microservices/core/src/application/stripe/eventHandlers/_helpers.ts` into a `@persistence/stripe-helpers` workspace; remove the duplicated copy from `scripts/reconcile-stripe.ts`. Known tech-debt from PR #70 close-out.
- **Reconcile cron + Slack alerting** — `scripts/reconcile-stripe.ts` is manually runnable. Future: daily cron via SST schedule + Slack alerting on `failed > 0`.
- **Per-customer reconcile fast-path** — Stripe's list API doesn't accept metadata-equality predicates, so `--user-id` filter is client-side today. Acceptable at current scale (<10k subs).
- **Node.js 20 GitHub Actions deprecation** — multiple workflow steps use `@v4` actions running on Node 20. Force-default to Node 24 by June 2026.

## Dep overrides — context for future readers

Root `package.json` now carries:

```json
"overrides": {
  "@sinclair/typebox": "^0.34.0",
  "react-dom": "19.2.0"
}
```

- **`@sinclair/typebox: ^0.34.0`** — Elysia 1.4.28 requires this minimum but a transitive resolution was pinning 0.27.10, narrowing `ElysiaStringOptions` so `format` and `minLength` weren't recognised on existing `t.String(...)` sites. PR #71 CI was passing only because of a stale resolution snapshot.
- **`react-dom: 19.2.0`** — Expo 55 pins `react: 19.2.0` exactly; the typebox override cascade re-resolved `react-dom` to 19.2.6, mismatching `react`. Forced exact-pin alignment.

If a future dep bump changes these constraints, revisit the override block.

## Inspector Brad cadence summary

PR #72 closed at 3 sweeps (1 high + 1 med + 1 low in sweep #1; 1 high + 1 low in sweep #2; sweep #3 clean). Pattern across the 3 Stripe PRs:

| PR  | Sweeps | Findings        | False-positive rate |
| --- | ------ | --------------- | ------------------- |
| #69 | 3      | (Brad's recall) | —                   |
| #70 | 8      | 14              | 0%                  |
| #71 | 1      | 4               | 0%                  |
| #72 | 3      | 5               | 0%                  |

100% real-bug rate stays consistent. Trace-before-patch (read the actual code, repro the failure path, write the fix + regression test) is non-negotiable.

## When in doubt

Read `/Users/bradleysimms-evans/.claude/projects/-Users-bradleysimms-evans-Documents-projects-personal-persistence-backend-sst/memory/MEMORY.md` and `CLAUDE.md` at repo root before doing anything else.
