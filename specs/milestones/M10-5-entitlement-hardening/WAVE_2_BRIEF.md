# M10.5 — Wave 2: per-screen feature-gate integration

Wave 2 picks up where Wave 1 leaves off: with `useFeatureGate`, `FeatureGatePrompt`, and `SubscriptionBadge` shipped, integrate them across the paywalled screens of the app.

## When this Wave spawns

Spawn the three Wave 2 agents ONLY after Wave 1 has merged into `feat/m10-5-entitlement` (the M10.5 PR branch). The Wave 2 worktrees fork off that merged HEAD so the primitives are importable.

## Three parallel agents — disjoint screen trees

| Agent                 | Brief                                                                | Screens                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m105-gates-workouts` | [`WAVE_2_GATES_WORKOUTS_BRIEF.md`](./WAVE_2_GATES_WORKOUTS_BRIEF.md) | Exercise library (lock customs beyond `workout_limit` reads — actual enforcement is server). Workout creator (lock AI-generated workout step when `!aiAccess`). Workout limit warning at limit-3, gate at limit-equal. Session start. |
| `m105-gates-progress` | [`WAVE_2_GATES_PROGRESS_BRIEF.md`](./WAVE_2_GATES_PROGRESS_BRIEF.md) | Progress tab (lock advanced analytics for free tier). Health integration (lock for free tier — premium-and-above can wire HealthKit). Profile tab (render `SubscriptionBadge` next to display name).                                  |
| `m105-gates-trainer`  | [`WAVE_2_GATES_TRAINER_BRIEF.md`](./WAVE_2_GATES_TRAINER_BRIEF.md)   | Trainer route stubs — Clients tab placeholder (until M8 ships real implementation). Gate access by `tier.isTrainerTier`.                                                                                                              |

Files are disjoint across the three agents — no merge conflicts expected.

## Cross-cutting (carry into all three agent briefs)

1. **`useFeatureGate(feature)` is the only entry point.** Don't add ad-hoc tier checks. Don't read `subscription.tierName` directly. The hook is the abstraction.
2. **`FeatureGatePrompt` renders the paywall.** Don't build custom paywall UI per-screen. The component is the abstraction. If a screen needs a different layout, that's a feature request for the primitive (back to Wave 1) — NOT a per-screen override.
3. **402 from the server takes precedence.** A user might pass the client-side gate (cached state says they're entitled) but the server's `assertEntitlement` denies. Catch the `ApiError` with `code: 'ENTITLEMENT_DENIED'` and surface the same `FeatureGatePrompt` using the verdict from the response — don't re-derive client-side.
4. **No silent feature locks.** Every paywalled feature shows the prompt; never an invisible no-op or a "Coming soon" toast. STORY-004 AC 4.6 explicitly: "Paywalled features show upgrade prompt, not hidden".
5. **Optimistic UI is fine.** A user tapping "Add custom workout" while at limit can see the form load briefly before the server 402 swaps it for the gate prompt. Don't pre-block at the tap — let the server be authoritative.

## Success criteria (Wave 2 review gate)

Done when:

1. Free-tier user: exercise library renders system exercises normally; tapping "Add custom" routes to creator → form mounts → on submit, server returns 402 → `FeatureGatePrompt` swaps in showing upgrade-to-Basic CTA → tap → routes to Selection.
2. Basic-tier user near workout limit: workout creator shows a warning banner ("3 workouts remaining this month"); at limit, `FeatureGatePrompt` renders before the form.
3. Free-tier user: Progress tab shows basic stats; advanced analytics section (PRs over time, volume trends) shows `FeatureGatePrompt` with upgrade-to-Premium CTA.
4. Free-tier user: Health integration section locked with `FeatureGatePrompt`.
5. Profile screen: `SubscriptionBadge` chip next to display name; correct tier; "Trial" / "Cancelled" suffix when appropriate.
6. Non-trainer user (or free-trainer-tier user): trainer route stubs show `FeatureGatePrompt` with upgrade-to-trainer-tier CTA.
7. Per-PR gates: prettier / typecheck / lint / build / all suites green; 90%+ branch coverage on touched files.

## Out of scope for Wave 2

- Backend changes (Wave 1 covers all server-side enforcement).
- New screens (only existing screens get gates).
- Visual polish beyond the existing M10 theme tokens — M11 owns that.
- Trainer Clients tab full implementation (M8 milestone).

## Why this gets its own brief

Wave 2 could have been bundled into the M10.5 BRIEF.md but splitting it as its own document means:

1. Wave 2 agents read a focused doc instead of the full M10.5 overview.
2. The Wave 1 / Wave 2 dependency boundary is explicit — Wave 2 spawn is gated on Wave 1 merge.
3. The screens touched are scoped per-agent without duplicating Wave 1 backend context every time.
