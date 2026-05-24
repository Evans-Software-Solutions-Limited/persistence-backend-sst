# M10.5 — Mobile Offline-UX Agent Brief (`m105-mobile-offline-ux`)

You are implementing the offline + slow-network UX slice of M10.5 on the subscription screens. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the React Native / Expo mobile app at `packages/mobile/`. You are NOT touching the backend (`m105-backend` agent's territory) and you are NOT touching the feature-gate primitives (`m105-mobile-primitives` agent's territory). You may read those for context but must not modify them.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — updated 2026-05-24 with STORY-011 + new "Offline UX on subscription screens" section in `design.md`.
- Mobile rules: [`../../_agent.md`](../../_agent.md) — hexagonal arch, container/presenter split, 90% global coverage.
- **Brad's explicit call:** no client-side grace windows / `validUntil` / clock-rollback detection. `expiresAt` is trusted as-is; server enforces. Your work is real-user offline UX, NOT abuse defense.

## Spec alignment — READ FIRST

Parent spec already updated. Cite the relevant section in every commit footer:

```
Implements: specs/11-payments-subscriptions/design.md § Offline UX on subscription screens
Closes: specs/11-payments-subscriptions/tasks.md § Phase 11
Satisfies: specs/11-payments-subscriptions/requirements.md AC 11.1, 11.2, 11.3
```

## Scope

Four slices. Recommended commit order: `useOnlineStatus` hook → banner + offline pre-flight → slow-network indicator → 3DS network-drop recovery. Land all on the same branch.

### 1. `useOnlineStatus()` hook

Location: `packages/mobile/src/ui/hooks/useOnlineStatus.ts`

Wraps `@react-native-community/netinfo` (already a transitive dep in legacy — verify in your worktree via `cat package.json | grep netinfo`; if missing, add `@react-native-community/netinfo` to `packages/mobile/package.json`).

```typescript
export function useOnlineStatus(): boolean;
```

Subscribes to network info events; returns `true` when online (reachable + connected), `false` otherwise. Cleans up the subscription on unmount.

Make it injectable for tests: don't directly import `NetInfo` inside the hook. Instead, expose a tiny `NetInfoPort` abstraction:

```typescript
// packages/mobile/src/domain/ports/netInfo.port.ts
export interface NetInfoPort {
  isConnected(): Promise<boolean>;
  subscribe(listener: (connected: boolean) => void): () => void;
}
```

With a `RNNetInfoAdapter` and an `InMemoryNetInfoAdapter` for tests. Wire it through the existing `Adapters` context.

### 2. Offline banner + pre-flight on the subscription screens

Modify `packages/mobile/src/ui/containers/SubscriptionSelectionContainer.tsx` and `packages/mobile/src/ui/containers/SubscriptionManagementContainer.tsx`:

- Read `useOnlineStatus()` at the top of each container
- Pass an `isOffline` prop to the presenters
- Presenters render a small "You're offline" banner above the existing content when `isOffline`. The banner styling is a single line with a network-down icon — keep it minimal; matches the existing offline indicators elsewhere in the app if any exist (search for `offline` in the codebase first).
- In container handlers (`handleTierSelect`, `handleConfirmCancel`, the Management screen's `handleUpgrade` / `handleDowngrade` / `handleCancel`): pre-flight check `useOnlineStatus()`. If offline, show:

```typescript
Alert.alert(
  "You're offline",
  "You need to be online to manage your subscription. Please reconnect and try again.",
);
return;
```

Place this check BEFORE any `Apple Pay` / `createSubscription` / `cancelSubscription` invocation. The check fires BEFORE the Apple Pay sheet is mounted.

The CTAs themselves stay visually disabled-style when offline (use a `style.disabled` opacity) but remain tappable so the user gets the alert explaining why.

### 3. Slow-network "still working…" indicator

Locations: where `useSubscriptionTiers` and `useMySubscription` are consumed (the two containers).

Pattern:
- Each container tracks `isSlowLoading` boolean local state
- Sibling `setTimeout` runs alongside the Tanstack query: after 8s of `isLoading === true`, flip `isSlowLoading = true`
- Clear the timeout on query success / error
- Pass `isSlowLoading` to the presenter; presenter renders "Still loading subscription information..." text below the existing loader

Don't cancel or retry the underlying query — just add UI feedback that the work is ongoing.

Make the 8s threshold a named constant (`SLOW_NETWORK_INDICATOR_DELAY_MS = 8000`) so it's easy to tune.

### 4. 3DS network-drop recovery

In `SubscriptionSelectionContainer`'s `handlePaymentMethodReady` callback, the 3DS branch currently calls `payments.confirm3DS(clientSecret)`. Wrap that call to:
- Pre-flight `useOnlineStatus()` check
- If offline before 3DS → "You need to be online to complete payment verification. Your subscription is on hold." + reset selectedTier + don't show 3DS
- If `confirm3DS` throws with what looks like a network error → "Connection lost during payment verification. Please try again." + reset state

The pre-existing `setIsProcessingSubscription(false)` cleanup must still run in all branches.

## Wire to the existing Apple Pay flow — no regressions

The buy flow today is: tap tier → mount `PaymentMethodForm` → triggers Apple Pay → calls `onPaymentMethodReady(paymentMethodId)` → calls `createSubscription`. Your pre-flight check fires BEFORE `setSelectedTierForPayment(tier)` in `handleTierSelect`. If offline, the form never mounts.

This means the existing M10 tests that check Apple Pay UI must continue to pass. Make sure the offline branch only fires when offline — don't accidentally short-circuit the online path.

## Tests

`packages/mobile/src/ui/hooks/__tests__/useOnlineStatus.test.tsx`:
- Returns true when adapter reports connected
- Returns false when adapter reports disconnected
- Updates on subscription event
- Cleans up subscription on unmount

`packages/mobile/src/adapters/netInfo/__tests__/InMemoryNetInfoAdapter.test.ts`:
- `setConnected(false)` then read returns false
- Subscribers fire on transitions

`packages/mobile/src/ui/containers/__tests__/SubscriptionSelectionContainer.test.tsx` (extend existing):
- Offline + tap tier → alert fires + Apple Pay does NOT mount + no `createSubscription` call
- Offline → online → tap tier → Apple Pay mounts normally
- Online + slow query (>8s) → "Still loading..." indicator visible
- Offline + tap cancel → alert + no cancel mutation

`packages/mobile/src/ui/containers/__tests__/SubscriptionManagementContainer.test.tsx` (extend existing):
- Offline + tap upgrade/downgrade/cancel → alert + no mutation

90% global coverage non-negotiable.

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun --filter @persistence/mobile test:unit
```

Expected delta: ~20–30 new mobile tests.

## Files you will touch

```
packages/mobile/package.json                                     # if @react-native-community/netinfo missing
packages/mobile/src/domain/ports/
  netInfo.port.ts                                                # new
packages/mobile/src/adapters/netInfo/
  rnNetInfo.adapter.ts                                           # new (production)
  __tests__/InMemoryNetInfoAdapter.ts                            # new (tests)
  __tests__/InMemoryNetInfoAdapter.test.ts                       # new
packages/mobile/src/ui/hooks/
  useOnlineStatus.ts                                             # new
  __tests__/useOnlineStatus.test.tsx                             # new
packages/mobile/src/ui/containers/
  SubscriptionSelectionContainer.tsx                             # extend
  SubscriptionManagementContainer.tsx                            # extend
  __tests__/SubscriptionSelectionContainer.test.tsx              # extend
  __tests__/SubscriptionManagementContainer.test.tsx             # extend
packages/mobile/src/ui/presenters/
  SubscriptionSelectionPresenter.tsx                             # add offline banner + slow-loading slot
  SubscriptionManagementPresenter.tsx                            # add offline banner + slow-loading slot
  __tests__/SubscriptionSelectionPresenter.test.tsx              # extend
  __tests__/SubscriptionManagementPresenter.test.tsx             # extend
packages/mobile/src/shared/types.ts                              # add netInfo to Adapters if existing
packages/mobile/src/ui/hooks/useAdapters.tsx                     # add netInfo getter if existing
```

## Files you will NOT touch

- `microservices/` — backend agent's territory
- `packages/mobile/src/ui/hooks/useFeatureGate.ts` — primitives agent's territory
- `packages/mobile/src/ui/components/subscription/FeatureGatePrompt.tsx` — primitives agent's territory
- `packages/mobile/src/ui/components/subscription/PaymentMethodForm.tsx` — leave the Apple Pay form itself unchanged; gate it FROM the container, not by modifying it
- M10's `MockPaymentsAdapter` / `StripeApplePayAdapter` — leave intact
- The Stripe webhook handler / reconcile script — out of scope

## Inspector Brad expectations

Offline UX is where edge cases live (state racing, double-fires, transitions mid-flow). Expect 1–3 sweeps.

Things Brad has flagged on similar work:

- Network status hook causing infinite re-renders (missing dependency array entry)
- Stale state in async handlers (e.g., user goes offline mid-mutation; the in-flight handler doesn't see the change)
- Pre-flight checks that don't account for the `selectedTierForPayment` already being set
- Tests that only cover happy path

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
