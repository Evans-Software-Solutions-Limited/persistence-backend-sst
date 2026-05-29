# 12 — Production Readiness: Tasks

> **Spec rewritten from scratch on 2026-05-28.** Prior tasks preserved in git history.

---

## Phase 12.1 — Legacy theme retirement (1 PR)

- [ ] **T-12.1.1** Run `git grep -l "LegacyTheme" packages/mobile/src/` — catalogue every import site. Implements requirements STORY-001.
- [ ] **T-12.1.2** Per import site: remove the import + replace token references inline.
- [ ] **T-12.1.3** Delete `homeLegacyTheme.ts`, `workoutsLegacyTheme.ts`, `subscriptionLegacyTheme.ts`, `profileLegacyTheme.ts`.
- [ ] **T-12.1.4** Remove `*LegacyTheme` allow-list entry from the `no-raw-hex-colors` ESLint rule.
- [ ] **T-12.1.5** Verify `bun run typecheck` passes. Screenshots before/after per touched screen.

## Phase 12.2 — Reduced-motion contract (1 PR)

- [ ] **T-12.2.1** Author `packages/mobile/src/ui/hooks/useReducedMotionGate.ts` per `design.md § Reduced-motion contract`. Implements STORY-003.
- [ ] **T-12.2.2** `<Ring>` / `<MultiRing>` / `<Bar>` / `<BottomSheet>` / `<TabBar>` / `<ActiveWorkoutBar>` updated to consume `useReducedMotionGate()` instead of `useReducedMotion()` directly.
- [ ] **T-12.2.3** Unit tests verify every primitive respects the gate (mock `useReducedMotion` true + false).

## Phase 12.3 — Sentry mobile init + error boundaries (1 PR)

- [ ] **T-12.3.1** Add `@sentry/react-native` dep + run pod install. Implements STORY-006 AC 6.1.
- [ ] **T-12.3.2** Init in `app/_layout.tsx` per `design.md § Sentry mobile init`. PII scrubbing in `beforeSend`.
- [ ] **T-12.3.3** Author `<ErrorBoundary>` component in `packages/mobile/src/ui/components/`. `<ErrorFallback>` UI with Reload Btn.
- [ ] **T-12.3.4** Wrap every screen container's return in `<ErrorBoundary>`.
- [ ] **T-12.3.5** Test event verified in Sentry from a manual error trigger.

## Phase 12.4 — Sentry SST Lambda init (1 PR)

- [ ] **T-12.4.1** Add `@sentry/node` to `microservices/core/package.json`. Implements STORY-006 AC 6.2.
- [ ] **T-12.4.2** Author `microservices/core/src/infra/observability/sentry.ts` per `design.md § Sentry SST Lambda init`.
- [ ] **T-12.4.3** Codemod every Lambda handler entry point to wrap with `wrapHandler`.
- [ ] **T-12.4.4** SST Resource for SentryDSN binding.
- [ ] **T-12.4.5** Test event verified.

## Phase 12.5 — Performance audit + FlashList sweep (1 PR)

- [ ] **T-12.5.1** Convert audit-listed surfaces to `<FlashList>` per `design.md § Performance audit`. Implements STORY-004 AC 4.1 + 4.2.
- [ ] **T-12.5.2** Memoise heavy composites (`<ClientRow>`, `<ExerciseCard>`, `<PRCard>`, `<NotificationRow>`).
- [ ] **T-12.5.3** 60fps scroll verified on low-spec test devices (iPhone 8 sim + Pixel 5 emu).

## Phase 12.6 — expo-image adoption (1 PR)

- [ ] **T-12.6.1** Add `expo-image` dep. Implements STORY-005.
- [ ] **T-12.6.2** Codemod user-uploaded photo render sites (avatars, exercise photos, recipe photos, meal photos).
- [ ] **T-12.6.3** Client-side photo compression on upload (target ≤ 800KB).

## Phase 12.7 — A11y audit pass (1 PR)

- [ ] **T-12.7.1** Manual VoiceOver walk-through every screen — record findings. Implements STORY-002.
- [ ] **T-12.7.2** Manual TalkBack walk-through every screen.
- [ ] **T-12.7.3** Fix every issue surfaced. Findings documented in `docs/a11y-audit-results.md`.
- [ ] **T-12.7.4** Touch-target overlay audit (developer-tool toggle).
- [ ] **T-12.7.5** Tab bar announces mode + label + badge correctly per STORY-002 AC 2.3.

## Phase 12.8 — EAS build profiles + CI (1 PR)

- [ ] **T-12.8.1** Author `eas.json` profiles per `design.md § EAS build profile structure`. Implements STORY-007.
- [ ] **T-12.8.2** Bind Sentry DSN + Expo channel + env file per profile via EAS secrets.
- [ ] **T-12.8.3** CI step builds `preview` profile on every merge to `main` + posts URL to Slack.
- [ ] **T-12.8.4** EAS Submit configuration for App Store Connect + Play Console.

## Phase 12.9 — iOS Apple IAP integration (1 PR)

- [ ] **T-12.9.1** Add `react-native-iap` dep. Implements STORY-008.
- [ ] **T-12.9.2** Author `adapters/payments/ios-iap.adapter.ts` per `design.md § iOS IAP integration`.
- [ ] **T-12.9.3** Product IDs registered in App Store Connect + mirrored in `app.config.ts`.
- [ ] **T-12.9.4** Backend `POST /subscriptions/ios-receipt` handler — Apple receipt verifier + entitlement grant.
- [ ] **T-12.9.5** Mobile platform branching: iOS → IAP flow; Web/Android → Stripe.
- [ ] **T-12.9.6** Restore Purchases CTA on iOS.
- [ ] **T-12.9.7** Subscription-management screen on iOS shows "Manage in App Store" link.
- [ ] **T-12.9.8** Compliance review of every paywall string for §3.1.1.

## Phase 12.10 — App Store + Play Store assets (1 PR — assets only)

- [ ] **T-12.10.1** Generate screenshots for all required device sizes. Implements STORY-009.
- [ ] **T-12.10.2** App icon at all required sizes.
- [ ] **T-12.10.3** Marketing copy: title, subtitle, description, promotional text, keywords.
- [ ] **T-12.10.4** Privacy policy URL: static export of `(app)/profile/terms` to a public web URL.
- [ ] **T-12.10.5** Age rating questionnaire completed.
- [ ] **T-12.10.6** Demo account credentials prepared.

## Phase 12.11 — Pre-launch verification (1 PR — checklist)

- [ ] **T-12.11.1** Full e2e on TestFlight build covering: sign-up → first workout → log session → see PR → check streak → switch to coach (if trainer) → add client → submit IAP subscription. Implements STORY-010.
- [ ] **T-12.11.2** Sentry P1 check: 7-day window with zero P1s on staging.
- [ ] **T-12.11.3** Offline mode walk-through: full app navigable + active session works without network for the entire session duration.
- [ ] **T-12.11.4** Apple IAP sandbox subscription verified.
- [ ] **T-12.11.5** Stripe test mode subscription verified on Android + Web.

## Phase 12.12 — Submission

- [ ] **T-12.12.1** App Store submission via `eas submit --profile production --platform ios`.
- [ ] **T-12.12.2** Play Store submission via `eas submit --profile production --platform android`.
- [ ] **T-12.12.3** Monitor review queue + respond to any reviewer questions.

## Phase 12.13 — `user_subscriptions` IAP uniqueness migration (1 PR — load-bearing for iOS IAP)

Owned by this spec (the `M11-polish` slot is deleted as of the design-port rewrite, so this migration's owner is the spec that defines the constraint's contract — i.e. this one). Lands BEFORE Phase 12.9 (iOS IAP integration) because the `grantIosSubscription` ON CONFLICT path documented in `design.md § grantEntitlement ownership contract` depends on the index being present in production.

**No new table.** The grant writes to the existing `user_subscriptions` table (`packages/db/src/schema.ts:293`) — the same table `assertEntitlement` reads and the Stripe flow writes. Apple's `original_transaction_id` is stored in the existing `external_subscription_id` column (parallel to the Stripe subscription id already stored there). Earlier drafts referenced a fictional `entitlements` table — corrected per Inspector Brad sweep 17.

- [ ] **T-12.13.1** Audit `packages/db/src/schema.ts` `userSubscriptions` — `external_subscription_id`, `tier_name`, `payment_status`, `expires_at`, `metadata` already exist (no column additions needed). Confirm no migration is required beyond the index below.
- [ ] **T-12.13.2** Drizzle migration: `CREATE UNIQUE INDEX user_subscriptions_external_sub_uq ON user_subscriptions (external_subscription_id) WHERE external_subscription_id IS NOT NULL;` (partial — the column is nullable for legacy/manual rows). This is the load-bearing DB-level half of the receipt-replay defence — the `grantIosSubscription` ON CONFLICT path silently never fires without it. Verify via integration test that two concurrent grants with the same `external_subscription_id` from different users return distinct GrantResult statuses (one `granted`, one `owned_by_other_user`).
- [ ] **T-12.13.3** Author `grantIosSubscription` at `microservices/core/src/application/subscriptions/grantIosSubscription.ts` per `design.md § grantEntitlement ownership contract`. Test coverage — three branches: `granted` (first insert), `renewed` (same user re-submits), `owned_by_other_user` (cross-user replay). Each test asserts RETURNING emits exactly one row. Plus: a test that an IAP grant for a user with a pre-existing active Stripe sub supersedes the Stripe row (sets `payment_status = 'cancelled'`) inside the same transaction so `user_subscriptions_active_unique` isn't violated.

---

## Acceptance gate (production readiness phase complete)

- [ ] All 13 phases shipped as PRs.
- [ ] App Store + Play Store submissions accepted (or in review pending acceptance).
- [ ] Sentry observability live with PII scrubbing verified.
- [ ] Reduced-motion contract honoured by every primitive.
- [ ] All `*LegacyTheme` files deleted.
- [ ] Pre-launch checklist complete + Sentry P1-free 7-day window.

---

_End of `12-production-readiness/tasks.md` · 2026-05-28 (rewritten from scratch)_
