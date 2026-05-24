# M10.5 — Wave 2 Agent Brief (`m105-gates-progress`)

Per-screen feature-gate integration for the progress + health + profile area. Read [`WAVE_2_BRIEF.md`](./WAVE_2_BRIEF.md) and [`BRIEF.md`](./BRIEF.md) first.

You spawn ONLY after Wave 1 has merged. Your worktree forks off `feat/m10-5-entitlement` HEAD.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — STORY-004 + STORY-010.
- Wave 1 primitives are the only feature-gate UI you import.

## Scope — three screen integrations

### 1. Progress tab — advanced analytics gate

File: `packages/mobile/app/(app)/(tabs)/progress.tsx` + the container at `packages/mobile/src/ui/containers/ProgressContainer.tsx` (or wherever M4 lands the Progress tab — if M4 hasn't shipped yet, your work targets the current placeholder).

The Progress tab in legacy shows: PRs over time, volume trends, body measurement charts, session summary cards. Tier-gating per legacy behaviour:

- **Free tier:** session list + basic stats (last 30 days workout count, current weight) visible. PR carousel, volume chart, advanced trends locked.
- **Basic tier:** same — analytics are Premium+.
- **Premium tier:** everything unlocked.
- **Trainer tiers:** everything unlocked (analytics + reporting per `analyticsAccess` flag).

Use a sectioned approach: render the unlocked sections normally; replace each locked section with a small `FeatureGatePrompt` inline (not a full-screen takeover):

```typescript
const advancedAnalytics = useFeatureGate("analytics");

// ...
<Section title="Personal Records">
  {advancedAnalytics.allowed
    ? <PRCarousel records={data.prs} />
    : <FeatureGatePrompt {...advancedAnalytics.gateProps} compact />
  }
</Section>
```

(`compact` is a variant on `FeatureGatePrompt`; if Wave 1's primitives don't expose it, flag in your report — you can use the default variant and just render it within the section bounds. The component should fit.)

Note: `analytics` isn't currently in the `EntitlementFeature` enum as defined in Wave 1's brief. Use the closest existing feature (probably `unlimited_exercise_library` as a stand-in or `ai_workout` for predictive analytics). Better: flag this as a spec gap → propose adding `advanced_analytics` to the enum on both backend (`assertEntitlement.ts`) and mobile (`entitlement.ts`). Don't add the feature yourself; flag and use the closest stub.

### 2. Health integration gate

File: `packages/mobile/app/(app)/(tabs)/home.tsx` or wherever the health tiles live (Home dashboard shows HealthKit data per M1 spec).

The HealthKit integration (steps, energy, body fat, body weight tiles) requires premium per legacy behaviour. The actual native integration may already be implemented and gated only by free/premium check.

Gate pattern:

```typescript
const healthGate = useFeatureGate("gym_buddy");
// gym_buddy is the closest existing stub flag for "premium feature" today.
// Flag in your report if a `health_integration` feature should be added.

if (!healthGate.allowed) {
  // render the health tiles section as locked
  return <FeatureGatePrompt {...healthGate.gateProps} compact />;
}
```

Same caveat as #1 — `health_integration` isn't a defined feature; use closest existing stub or flag spec gap.

### 3. Profile tab — SubscriptionBadge placement

File: `packages/mobile/app/(app)/(tabs)/profile.tsx` + `packages/mobile/src/ui/containers/ProfileContainer.tsx` (post-M6).

Add the `SubscriptionBadge` chip next to the user's display name. Use the cached `MySubscription` for `tier` + `paymentStatus`. The component handles its own styling.

```typescript
const sub = useMySubscription();

<View style={styles.nameRow}>
  <Text style={styles.name}>{profile.displayName}</Text>
  {sub.data ? (
    <SubscriptionBadge
      tier={sub.data.tierName}
      paymentStatus={sub.data.paymentStatus}
      compact
    />
  ) : null}
</View>
```

Also: extend Profile's "Subscription" row (the entry-point to Subscription Management) to show the current tier name inline. Cosmetic, not gated.

## Tests

`packages/mobile/src/ui/containers/__tests__/ProgressContainer.test.tsx`:

- Free user: basic stats visible; gate prompt visible where advanced sections used to render
- Premium user: full progress data visible; no gate prompts

`packages/mobile/src/ui/containers/__tests__/HomeContainer.test.tsx` (or wherever health tiles live):

- Free user: health tiles section locked with gate prompt
- Premium user: tiles render

`packages/mobile/src/ui/containers/__tests__/ProfileContainer.test.tsx`:

- SubscriptionBadge renders for each tier (parameterised test)
- Trial / Cancelled suffix appears at the right times
- Profile sub-management row navigates correctly

90% global coverage non-negotiable.

## Files you will touch

```
packages/mobile/app/(app)/(tabs)/progress.tsx                       # add gate wrap
packages/mobile/app/(app)/(tabs)/home.tsx                            # add gate on health tiles section
packages/mobile/app/(app)/(tabs)/profile.tsx                         # add SubscriptionBadge
packages/mobile/src/ui/containers/
  ProgressContainer.tsx                                              # extend with useFeatureGate
  HomeContainer.tsx (or whichever)                                    # extend
  ProfileContainer.tsx                                                 # extend
  __tests__/*.test.tsx                                                 # extend
packages/mobile/src/ui/presenters/
  (corresponding presenters)                                           # extend with gate slots
```

## Files you will NOT touch

- Wave 1 primitives (`useFeatureGate`, `FeatureGatePrompt`, `SubscriptionBadge`) — final
- Sibling Wave 2 agents' files
- `microservices/` — final
- Health adapters (`packages/mobile/src/adapters/health/`) — the gate is at the UI layer, not the adapter

## Edge cases

- Profile screen where `useMySubscription` is still loading: don't crash; show a placeholder or skip the badge until data lands.
- Progress sections where the underlying data isn't available (M4 hasn't shipped that section): if the section currently doesn't render at all, your gate is irrelevant — leave the placeholder and add a TODO comment referencing the M4 spec.
- Cancelled-but-active user: gate passes until `expiresAt`. Render normally.
- Tier change mid-session: re-renders pick up the new `useMySubscription` data on next focus; cached UI may briefly show the old gate state. Acceptable.

## When you finish

Same report shape as the other agents. Include a clear list of:

- Spec gaps you flagged (probably: `analytics`, `health_integration` features missing from the enum; `compact` variant on `FeatureGatePrompt`)
- Screens you gated, screens you found-and-skipped (because they don't yet exist on this branch)

Citations:

```
Implements: specs/11-payments-subscriptions/design.md § Per-screen feature-gate integration (Wave 2)
Closes: specs/11-payments-subscriptions/tasks.md § Phase 12 (m105-gates-progress subset)
Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6
```
