# M10.5 — Mobile Primitives Agent Brief (`m105-mobile-primitives`)

You are implementing the feature-gate primitives slice of M10.5. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the React Native / Expo mobile app at `packages/mobile/`. You are NOT touching the backend (`m105-backend` agent's territory) and you are NOT touching the subscription screens themselves (`m105-mobile-offline-ux` agent's territory). You may read both for context but must not modify them.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — updated 2026-05-24 with STORY-010 + new "Mobile feature-gate model" section in `design.md`.
- Mobile rules: [`../../_agent.md`](../../_agent.md) — hexagonal arch, container/presenter split, 90% global coverage.
- Wire contract: the backend 402 response shape is defined in `design.md` § Entitlement enforcement > 402 response shape. Match field names exactly when parsing.

## Spec alignment — READ FIRST

Parent spec already updated. Cite the relevant section in every commit footer:

```
Implements: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
Closes: specs/11-payments-subscriptions/tasks.md § Phase 10
Satisfies: specs/11-payments-subscriptions/requirements.md AC 10.1, 10.2, 10.3
```

## Scope

Four slices. Recommended commit order: hook → component → badge → adapter 402 interception. Land all on the same branch.

### 1. `useFeatureGate(feature)` hook

Location: `packages/mobile/src/ui/hooks/useFeatureGate.ts`

```typescript
import type { EntitlementFeature } from "@/domain/models/entitlement";

export type FeatureGateReason = "tier" | "limit" | "cancelled" | "unknown";

export interface FeatureGateResult {
  allowed: boolean;
  reason: FeatureGateReason;
  gateProps: FeatureGatePromptProps;
}

export function useFeatureGate(feature: EntitlementFeature): FeatureGateResult;
```

**Pure function of the cached `MySubscription`** — reads from `useMySubscription()` and returns a verdict. No network in the hot path. The verdict logic mirrors the backend `assertEntitlement` rules but is computed client-side for UX (server-side is authoritative for actual writes).

Feature → rule mapping:

- `create_workout`: `paymentStatus IN ('active', 'trialing')` AND tier's `workoutLimit === null` (unlimited) OR `workoutLimit > 0` (free + basic have non-zero limits). Reason `'limit'` is hard to detect client-side without a usage counter — for M10.5, return `'tier'` reason for any non-active sub on this feature.
- `ai_workout`: `paymentStatus IN ('active', 'trialing')` AND `tierFeatures.aiAccess === true`. (Trial users count.)
- `gym_buddy`: `tier.gymBuddyAccess === true`.
- `unlimited_exercise_library`: stub — always allowed (matches backend stub).
- `trainer_clients`: `tier.isTrainerTier === true`.

`gateProps` returns the props the `FeatureGatePrompt` needs — feature display name, current tier, upgrade target, upgrade price, an `onUpgrade` callback. The callback uses Expo Router to push to `/(auth)/subscription-selection` with `tier` and `cycle` query params.

### 2. `FeatureGatePrompt` component

Location: `packages/mobile/src/ui/components/subscription/FeatureGatePrompt.tsx`

Pure presenter. Renders a paywall card:

- A lock icon
- Feature display name ("AI Workouts", "Gym Buddy access", "Custom workouts beyond your monthly limit")
- Current tier badge
- Upgrade tier card (a compact version of `SubscriptionCard` showing just name + price + 1–2 key features)
- "Upgrade to <tier>" primary CTA → calls `onUpgrade`
- "Not now" secondary CTA → calls `onDismiss`

Styling matches the Persistence theme tokens (`Colors`, `Spacing`, `BorderRadius`, `Shadows`). Don't /frontend-design polish — that's M11.

Props:

```typescript
export interface FeatureGatePromptProps {
  feature: EntitlementFeature;
  featureDisplayName: string;
  currentTier: SubscriptionTierName;
  upgradeTo: SubscriptionTierName | null;
  upgradePriceMonthly: number | null;
  onUpgrade: () => void;
  onDismiss?: () => void;
}
```

When `upgradeTo === null` (no upgrade path — e.g., user is already at top tier), don't render the upgrade CTA; show a "Contact support" link instead. Edge case but worth handling.

### 3. `SubscriptionBadge` component

Location: `packages/mobile/src/ui/components/subscription/SubscriptionBadge.tsx`

Compact chip showing the user's current tier. Used in Profile and elsewhere. Pure presenter.

```typescript
export interface SubscriptionBadgeProps {
  tier: SubscriptionTierName;
  paymentStatus: SubscriptionStatus;
  compact?: boolean; // smaller variant for tight layouts
}
```

Style variations:

- Free: grey background
- Basic: blue background
- Premium: gold background
- Trainer (any): purple background

Show "Trial" suffix when `paymentStatus === 'trialing'`. Show "Cancelled" suffix when `paymentStatus === 'cancelled'`.

### 4. `SSTApiAdapter` 402 interception

Location: `packages/mobile/src/adapters/api/sst-api.adapter.ts` (extend existing)

When any API call returns HTTP 402 with the structured body, the adapter should parse it into a domain `ApiError` carrying the same payload:

```typescript
export interface ApiError {
  // existing fields...
  code: string;
  message: string;
  status?: number;
  // M10.5: structured entitlement payload (present iff code === "ENTITLEMENT_DENIED")
  entitlement?: {
    feature: EntitlementFeature;
    currentTier: SubscriptionTierName;
    upgradeTo: SubscriptionTierName | null;
    upgradePriceMonthly: number | null;
  };
}
```

The adapter's fetch wrapper inspects the response: if `status === 402` AND body has `code: "ENTITLEMENT_DENIED"`, parse the `feature` / `current_tier` / `upgrade_to` / `upgrade_price_monthly` fields and stamp them on the `ApiError`. Convert snake_case → camelCase here so the rest of the mobile code is consistent.

Document this in a JSDoc comment near `mayFail` (or wherever fetch errors are translated).

Don't change error handling for any other status code — the existing 4xx/5xx mapping stays.

### Domain models touchpoint

Add `EntitlementFeature` to `packages/mobile/src/domain/models/entitlement.ts` (new file):

```typescript
// Mirrors microservices/core/src/application/entitlement/assertEntitlement.ts
export type EntitlementFeature =
  | "create_workout"
  | "ai_workout"
  | "gym_buddy"
  | "unlimited_exercise_library"
  | "trainer_clients";
```

Keep the two definitions in sync — if backend adds a feature, mobile mirrors. This is a known tech-debt item (similar to the reconcile-helpers duplication parent spec § Database / Trigger contract reminder).

## Tests

`packages/mobile/src/ui/hooks/__tests__/useFeatureGate.test.tsx`:

- For each feature: allowed when tier matches + active/trialing; denied otherwise with correct reason
- Returns sensible `gateProps` (feature name, upgrade target, callback)
- Stub features (`ai_workout`, `gym_buddy`, etc.) return allowed today

`packages/mobile/src/ui/components/subscription/__tests__/FeatureGatePrompt.test.tsx`:

- Renders the title, current tier badge, upgrade tier card, both CTAs
- `onUpgrade` fires on press
- `upgradeTo === null` path renders "Contact support" instead

`packages/mobile/src/ui/components/subscription/__tests__/SubscriptionBadge.test.tsx`:

- Renders the correct label + style for each tier
- Trial / Cancelled suffixes appear when status calls for them
- Compact variant collapses correctly

`packages/mobile/src/adapters/api/__tests__/sst-api.adapter.test.ts` (extend existing):

- 402 with `code: "ENTITLEMENT_DENIED"` + valid body → produces `ApiError` with `entitlement` field populated
- 402 with malformed body → falls back to standard `ApiError` (no `entitlement`)
- 4xx/5xx other than 402 → unchanged behaviour

90% global coverage non-negotiable.

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun --filter @persistence/mobile test:unit
```

Expected delta: ~25–40 new mobile tests.

## Files you will touch

```
packages/mobile/src/domain/models/
  entitlement.ts                                                 # new
packages/mobile/src/ui/hooks/
  useFeatureGate.ts                                              # new
  __tests__/useFeatureGate.test.tsx                              # new
packages/mobile/src/ui/components/subscription/
  FeatureGatePrompt.tsx                                          # new
  SubscriptionBadge.tsx                                          # new
  __tests__/FeatureGatePrompt.test.tsx                           # new
  __tests__/SubscriptionBadge.test.tsx                           # new
packages/mobile/src/adapters/api/
  sst-api.adapter.ts                                             # extend (402 interception)
  __tests__/sst-api.adapter.test.ts                              # extend
```

## Files you will NOT touch

- `microservices/` — backend agent's territory
- `packages/mobile/src/ui/containers/Subscription*Container.tsx` — offline-UX agent's territory
- Any screen file in `packages/mobile/app/` — per-screen integration is Wave 2
- `useMySubscription` and `useSubscriptionTiers` hooks — unchanged from M10
- `MockPaymentsAdapter` / `InMemoryApiAdapter` — leave as-is unless you need to extend the in-memory adapter to simulate 402 responses for your adapter test (in which case, add a `setNext402Response` helper)

## Inspector Brad expectations

Primitives are small surface but mistakes have downstream blast radius (every Wave 2 agent depends on the hook signature). Expect 1–2 sweeps.

Things Brad has flagged on similar work:

- Mock implementations that don't exercise the actual code path under test
- Snake/camel case drift between wire shape and domain shape
- Adapter error mapping that swallows useful information from the response body
- Test fakes pretending to be tests

TRACE before patching. Same protocol as M10.

## When you finish

- Tests pass; 90%+ coverage on touched files
- Commit + push your worktree branch
- Report:
  - Branch name
  - Commits
  - Test delta
  - Spec amendment flags
  - Decisions that diverged from this brief
