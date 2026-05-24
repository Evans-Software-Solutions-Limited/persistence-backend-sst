# M10.5 — Wave 2 Agent Brief (`m105-gates-workouts`)

Per-screen feature-gate integration for the workouts area. Read [`WAVE_2_BRIEF.md`](./WAVE_2_BRIEF.md) and [`BRIEF.md`](./BRIEF.md) first.

You spawn ONLY after Wave 1 has merged into `feat/m10-5-entitlement`. Your worktree forks off that HEAD so `useFeatureGate`, `FeatureGatePrompt`, and the `SSTApiAdapter` 402 interception are already in place.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — STORY-004 + STORY-010 cover the gate contract.
- Wave 1 primitives are the only feature-gate UI you import. Don't build new paywall components.

## Scope — three screen integrations

### 1. Exercise library

File: `packages/mobile/app/(app)/(tabs)/exercises.tsx` and its container at `packages/mobile/src/ui/containers/ExerciseLibraryContainer.tsx` (find it; M0 shipped that surface).

The library shows system exercises (always visible) + the user's custom exercises (filtered by `createdBy=mine` quick filter). The "Add custom exercise" CTA (`+` button) is the gated action — creating a custom exercise counts toward `workout_limit` per current backend behaviour? **Verify in the backend code before assuming** — read `microservices/core/src/application/exercises/create/exercisesCreateHandler.ts` to confirm whether `assertEntitlement('create_workout')` was wired there in Wave 1. If yes, gate the client side; if no, leave it as-is and flag the spec drift.

Actual integration: on the exercise creator screen (`packages/mobile/app/(app)/exercises/create.tsx`), wrap the form's submit handler:

```typescript
const { allowed, gateProps } = useFeatureGate("create_workout");

if (!allowed) {
  return <FeatureGatePrompt {...gateProps} />;
}
```

The `FeatureGatePrompt` replaces the entire form when the user is gated. When `allowed`, the form renders normally. On submit, if the server returns 402 (the user's count crossed the limit between gate-check and submit — rare but possible), catch the `ApiError`, parse the `entitlement` field, and re-render the gate with the server's verdict.

### 2. Workout creator — AI-generated step

File: `packages/mobile/app/(app)/workouts/create.tsx` or the container at `packages/mobile/src/ui/containers/WorkoutCreateContainer.tsx`.

If the workout creator has an "AI-generated workout" option (legacy `persistence-mobile` had this — verify what's currently in the V2 mobile app), gate it via `useFeatureGate('ai_workout')`. The free + basic tiers see the AI option disabled with a `FeatureGatePrompt` overlay; premium + trainer-pro tiers see it enabled.

Today `ai_workout` is stubbed (always allowed) on the backend per Wave 1's brief — so the gate will pass for ALL users right now. That's expected. The wiring needs to be in place so when the real AI endpoint ships, just flipping the backend `assertEntitlement('ai_workout')` rule to enforce changes UX everywhere automatically.

### 3. Workout limit warning + gate

File: same workout creator file as above, plus `packages/mobile/src/ui/containers/SessionStartContainer.tsx` (or wherever session-start handles creating a fresh workout — search the codebase).

On any screen that creates a new workout:
- Read `useMySubscription()`; read `workoutLimit` from the cached tier info
- Compute `remaining = workoutLimit - currentMonthCount` if both known (limit non-null + count known)
- When `remaining <= 3 && remaining > 0`: show a small inline warning banner above the create button ("3 workouts remaining this month — Upgrade to Premium for unlimited")
- When `remaining <= 0`: don't even let the user open the form. Render `FeatureGatePrompt` instead.

**`currentMonthCount` source:** read from `subscription_limits` via the existing `MySubscription.workoutsUsedThisMonth` field — IF it exists. If not, this is a spec gap — flag it in your report (the M10.5 backend agent might have added it; verify in your worktree). Without server-provided count, you can only do the hard gate via `useFeatureGate('create_workout')` which Wave 1 already gives you; skip the soft warning.

## Tests

Per screen, add container tests using `InMemoryApiAdapter`:

`packages/mobile/src/ui/containers/__tests__/ExerciseCreateContainer.test.tsx`:
- Free user sees `FeatureGatePrompt` instead of the form (assuming exercise creation is gated)
- Premium user sees the form
- Form submit with server 402 swaps to gate prompt
- Tap "Upgrade" routes to `/(auth)/subscription-selection?tier=basic`

`packages/mobile/src/ui/containers/__tests__/WorkoutCreateContainer.test.tsx`:
- Free user: AI option shows gate; manual option shows form
- Basic user near limit (mock `currentMonthCount = workoutLimit - 2`): warning banner visible
- Basic user at limit: gate prompt instead of form

90% global coverage non-negotiable.

## Files you will touch

```
packages/mobile/app/(app)/exercises/create.tsx                         # add gate wrap
packages/mobile/app/(app)/workouts/create.tsx                          # add gate + warning banner
packages/mobile/src/ui/containers/
  ExerciseCreateContainer.tsx (or wherever)                            # extend with useFeatureGate
  WorkoutCreateContainer.tsx                                            # extend
  SessionStartContainer.tsx (if applicable)                            # extend
  __tests__/*.test.tsx                                                  # extend
packages/mobile/src/ui/presenters/
  (corresponding presenter files for warning banner slot)              # extend
```

Note: you'll need to discover the actual container/presenter file names — M5 shipped exercise detail+creator after M0 baseline. Look at what M5 left.

## Files you will NOT touch

- `packages/mobile/src/ui/hooks/useFeatureGate.ts` — primitives are final, don't modify
- `packages/mobile/src/ui/components/subscription/FeatureGatePrompt.tsx` — final
- `packages/mobile/src/ui/components/subscription/SubscriptionBadge.tsx` — final
- The Subscription screens (`Subscription*Container.tsx`) — final
- `microservices/` — final
- Sibling Wave 2 agents' files (`m105-gates-progress` owns Progress / Profile, `m105-gates-trainer` owns trainer routes)

## Edge cases

- **Trainer user on a workout-creator screen**: trainer tiers don't have workout limits (typically); `useFeatureGate('create_workout')` returns allowed. Render form normally.
- **Cancelled-but-active user**: still entitled until `expiresAt`. Gate passes.
- **Premium user with AI access**: AI option enabled; manual option enabled; no warnings.
- **Server-side 402 on a path that the client thought was allowed**: catch in the mutation onError handler, parse `entitlement`, route to gate. This is the "client cache disagrees with server" case — server wins.

## When you finish

- Tests pass; 90%+ coverage on touched files
- Commit + push your worktree branch
- Report:
  - Branch name
  - Commits + line counts
  - Test delta
  - Which screens you gated (in case some target screens didn't exist yet — flag those as backlog)
  - Spec amendment flags (especially around `currentMonthCount` field availability)

Citations in commit footer:
```
Implements: specs/11-payments-subscriptions/design.md § Per-screen feature-gate integration (Wave 2)
Closes: specs/11-payments-subscriptions/tasks.md § Phase 12 (m105-gates-workouts subset)
Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6
```
