# M10.5 — Wave 2 Agent Brief (`m105-gates-trainer`)

Per-screen feature-gate integration for the trainer-only routes. Read [`WAVE_2_BRIEF.md`](./WAVE_2_BRIEF.md) and [`BRIEF.md`](./BRIEF.md) first.

You spawn ONLY after Wave 1 has merged. Your worktree forks off `feat/m10-5-entitlement` HEAD.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — STORY-004 + STORY-010 + STORY-006 (trainer tier).
- Wave 1 primitives are the only feature-gate UI you import.
- **M8** (Trainer Features milestone) is the milestone that will land the actual Clients tab + client management surface. M10.5 Wave 2 only stubs the gates — implementation comes later.

## Scope — smallest of the three Wave 2 agents

Three things:

### 1. Clients tab route stub gate

Per M10's success-screen routing, trainer subscriptions route to `/(tabs)/clients` after successful subscribe (the "Manage Clients" CTA on the success screen). That route was a stub when M10 shipped — confirm in your worktree:

```bash
ls packages/mobile/app/\(app\)/\(tabs\)/clients.tsx   # may or may not exist
```

If the route file exists as a placeholder: extend it to gate by `useFeatureGate('trainer_clients')`. Non-trainer or free-trainer (standard tiers may or may not have client management — verify legacy behaviour) sees the `FeatureGatePrompt` with upgrade CTA.

If the route file does NOT exist: create a minimal placeholder that calls `useFeatureGate('trainer_clients')` and either renders an "M8 coming soon" stub (when allowed) or the `FeatureGatePrompt` (when denied). The placeholder is a thin route file — no real client-management UI.

Same pattern for the success screen's "Manage Clients" button: it routes to `/(tabs)/clients` which now handles the gate itself, so no additional client-side check needed on the button.

### 2. Tab bar visibility for trainer routes

In the existing tab navigator (`packages/mobile/app/(app)/(tabs)/_layout.tsx`), the Clients tab is probably either always-rendered or conditionally shown based on `profile.role === 'personal_trainer'`. **Verify which.**

If always-rendered: add a condition so the tab only renders for `isTrainerTier` users (read from `useMySubscription`). Free + Basic + Premium users don't see a Clients tab at all.

If conditionally-rendered based on `profile.role`: that's correct behaviour — the trigger sets `profile.role = 'personal_trainer'` whenever an `isTrainerTier` sub is active. Leave as-is and just verify in a test.

### 3. Stub gate on any other trainer-only routes

Search the codebase for routes that exist but should be gated by `isTrainerTier`:

```bash
grep -rn "isTrainerTier\|personal_trainer\|physiotherapist" packages/mobile/app/ --include="*.tsx"
```

Any route file that gates by `role` directly should be updated to use `useFeatureGate('trainer_clients')` instead. Consistency over correctness here — they're functionally equivalent today (the role IS the entitlement), but going through `useFeatureGate` means future enhancements to the gate logic (e.g., partial trainer tiers without clients access) take effect uniformly.

## Tests

`packages/mobile/app/(app)/(tabs)/__tests__/clients.test.tsx` (or wherever the route placeholder lives):

- Non-trainer user sees `FeatureGatePrompt`
- Trainer-standard user sees the placeholder (or `FeatureGatePrompt` if standards don't get clients — verify the rule)
- Trainer-pro user sees the placeholder

Tab-bar visibility test (likely covered by an existing `_layout.test.tsx`):

- Free user: 4 tabs (no Clients)
- Trainer-pro user: 5 tabs (with Clients)

90% global coverage non-negotiable.

## Files you will touch

```
packages/mobile/app/(app)/(tabs)/clients.tsx                         # create or extend
packages/mobile/app/(app)/(tabs)/_layout.tsx                          # tab-bar visibility (if needed)
packages/mobile/src/ui/containers/
  ClientsContainer.tsx (or wherever)                                  # create stub or extend
  __tests__/*.test.tsx                                                # extend
```

Smallest scope of the three Wave 2 agents. Should be a 1-day slice including tests.

## Files you will NOT touch

- Wave 1 primitives — final
- Other Wave 2 agents' files (workouts area, progress/profile area)
- `microservices/` — final
- Any real trainer-client management logic — that's M8

## Edge cases

- User changes from trainer to user tier mid-session: tab bar re-renders with one fewer tab on next focus. Acceptable lag.
- Trainer-standard whose sub is `cancelled-but-still-active`: gate passes until `expiresAt`.
- Existing role-based code that gates by `profile.role`: when you migrate to `useFeatureGate`, make sure both produce the same answer for all current sub states. Add a regression test.

## When you finish

Same report shape. Be specific about:

- Whether the Clients tab route existed already (stub) or you created it
- Whether the tab bar already conditional-rendered, or you added the condition
- What you found in the legacy `persistence-mobile/components/trainer/` directory that should inform M8's brief (drop-link your notes)

Citations:

```
Implements: specs/11-payments-subscriptions/design.md § Per-screen feature-gate integration (Wave 2)
Closes: specs/11-payments-subscriptions/tasks.md § Phase 12 (m105-gates-trainer subset)
Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6, 6.1
```
