# 31 — Onboarding and experience polish · Delivery slices

**Approved delivery plan — 2026-08-31.** The Claude handoff has been reviewed
against `main` at `12dfda83`; implementation may begin from these slices.

## Slice A — One-time onboarding foundation

- [x] Approve revised requirements, copy, and prototype.
- [x] Add user-scoped onboarding state, routes, SQLite mirror, and isolation tests.
- [x] Add auth/onboarding gate with completed/dismissed terminal states.
- [x] Build the shared seven-page shell and stage vs whole-journey Skip behaviour.
- [x] Use the production Persistence logo asset.

## Slice B — Existing-component setup

- [x] Extract shared Edit Profile fields and validation.
- [x] Build reusable accessible `DatePickerField`; replace DOB raw text input.
- [x] Reuse Subscription Selection's Athlete/Coach values and state in one
      two-tile control (no tab/segmented duplicate).
- [x] Mount Habit Setup in onboarding mode using existing commands.
- [x] Add nutrition/training intent model and analytics.

## Slice C — Recommendation and purchase handoff

- [x] Add pure recommendation service with every intent/client-band matrix case.
- [x] Add recommendation state to existing Subscription Selection.
- [x] Highlight recommended card and explain matching choices.
- [x] Add Show other plans expansion using existing subscription cards.
- [x] Put trial eligibility banner on tile; keep CTA text as Subscribe.
- [x] Verify subscribe, restore, offline, existing-paid, and Continue with Free.

## Slice D — Separate body metrics and 1RM banner

- [x] Give the existing You/Progress Weight and Body Fat cards separate routes;
      do not rewrite Home.
- [x] Add separate Weight and Body Fat routes using shared graph/list primitives.
- [x] Add metric-specific logging actions and immediate cache refresh.
- [x] Add pure 1RM estimator and edge-case tests.
- [x] Add user/exercise-scoped performance-summary endpoint and cache, including
      actual 10RM, heaviest set at any rep count, best-set volume, lifetime
      volume, estimated 1RM, and estimated 10RM.
- [x] Insert the Estimated 1RM banner below Exercise Detail media only.

## Slice E — Coaching data contract

- [x] Document one coach/athlete relationship and assignment aggregate contract.
- [x] Fill missing athlete coach identity/target/goal/brief modules.
- [x] Preserve cached-active relationship state during refresh.
- [x] Add purposeful empty/setup states on both surfaces.
- [x] Invalidate both query-key families after related mutations.
- [x] Add active/loading/pending/ended/no-relationship contract tests.

## Slice F — Exercise ordering (OTA-compatible)

- [x] Reuse the already-shipped Gesture Handler/Reanimated stack; add no native
      dependency or app config for reordering.
- [x] Add drag handle to existing create/edit/live exercise rows.
- [x] Move superset members as a single contiguous block.
- [x] Persist template vs live-session order according to context.
- [x] Add VoiceOver/TalkBack move actions and haptic feedback.

## Date picker release note

- [x] Reuse the JS-only Fuel calendar for DOB, including direct month/year
      navigation. No native dependency or new store binary is required.

## Release gates

- [x] Task-scoped Prettier check (the full command is blocked only by unrelated
      pre-existing untracked files documented in the PR)
- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run build`
- [x] `bun run test:unit` with required coverage
- [x] iOS + Android screenshots for every onboarding page, separate body pages,
      1RM banner, and both coaching surfaces
- [x] VoiceOver/TalkBack pass for calendar, Skip, subscription cards, graphs,
      and 1RM information
- [x] Inspector Brad local sweep before any PR, then clean re-run
