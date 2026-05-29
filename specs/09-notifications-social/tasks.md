# 09 — Notifications & Social: Tasks

> **Spec rewritten from scratch on 2026-05-28.** Prior tasks preserved in git history.

---

## Backend status

**Already shipped (PR #81, 2026-05-27):** 6 endpoints + JSONB preferences + atomic merge + COALESCE read-state semantics. No further backend work required for v1 frontend ship.

---

## Phase 09.1 — Domain + adapters (1 PR)

- [ ] **T-09.1.1** Domain models in `packages/mobile/src/domain/models/`: `Notification`, `NotificationPreferences`, `NotificationType` union. Implements requirements STORY-007.
- [ ] **T-09.1.2** API port extensions in `domain/ports/api.port.ts`.
- [ ] **T-09.1.3** API adapter `adapters/api/notifications.adapter.ts` — 6 endpoint wrappers.
- [ ] **T-09.1.4** SQLite cache schema + repository per `design.md § SQLite cache schema`. 100-row LRU.
- [ ] **T-09.1.5** Sync queue handlers for mark-read + update-preferences + mark-all-read.

## Phase 09.2 — Push token registration + listener (1 PR)

- [ ] **T-09.2.1** Author `adapters/notifications/expo-notifications.adapter.ts` per `design.md § Push notification listener`. Implements STORY-004 ACs.
- [ ] **T-09.2.2** Wire in `app/_layout.tsx` — register on auth + setup listeners.
- [ ] **T-09.2.3** Permission-denial graceful path — banner on Preferences screen.
- [ ] **T-09.2.4** Token re-registration on auth change + Expo token rotation event.

## Phase 09.3 — Notifications list screen (1 PR)

- [ ] **T-09.3.1** Author `<NotificationRowPresenter>` spec-local composite per `design.md`. Icon mapping for every notification type. Implements STORY-002 AC 2.4.
- [ ] **T-09.3.2** Author `<NotificationsListPresenter>` with grouped sections (Today / Yesterday / This Week / Older) + FlashList + pull-to-refresh + pagination. Implements STORY-002 ACs.
- [ ] **T-09.3.3** Author `<NotificationsListContainer>` wiring `useGetNotifications` + mark-read + deep-link dispatch.
- [ ] **T-09.3.4** Route `(app)/notifications.tsx`.
- [ ] **T-09.3.5** Empty state copy.

## Phase 09.4 — Preferences screen (1 PR)

- [ ] **T-09.4.1** Author `<NotificationPreferencesPresenter>` per `design.md`. Categories grouped via `<Section>` + `<DrawerRow>` with Switch trailing. Implements STORY-003.
- [ ] **T-09.4.2** Author `<NotificationPreferencesContainer>` wiring `useGetPreferences` + `useUpdatePreferences`. Optimistic toggle handler.
- [ ] **T-09.4.3** First-time-open: write `DEFAULT_OPT_IN` to backend.
- [ ] **T-09.4.4** Permission-denial banner.
- [ ] **T-09.4.5** Route `(app)/profile/notifications.tsx`.

## Phase 09.5 — Home bell badge (1 PR)

- [ ] **T-09.5.1** Author `<HomeBellContainer>` + `<HomeBellPresenter>` per `design.md`. Implements STORY-001.
- [ ] **T-09.5.2** Mount inside `<HomeHeader>` via the `bell` slot exposed by `06-progress-goals`.
- [ ] **T-09.5.3** `useGetUnreadCount` hook with `staleTime: 30s` + refresh-on-focus.
- [ ] **T-09.5.4** `9+` overflow display for ≥10.

## Phase 09.6 — Deep-link dispatch wiring (1 PR)

- [ ] **T-09.6.1** Tap handler in `<NotificationRowPresenter>` calls mark-read THEN `router.push(deepLink)`. Implements STORY-005.
- [ ] **T-09.6.2** Push response listener (cold-start + background tap) routes per `data.deepLink`.
- [ ] **T-09.6.3** Unknown deep-link falls back to Home.
- [ ] **T-09.6.4** Integration test for `useLastNotificationResponse` cold-start dispatch.

## Phase 09.7 — Offline + cache verification (1 PR)

- [ ] **T-09.7.1** Verify cached list renders offline (cold-start without network).
- [ ] **T-09.7.2** Verify mark-read offline → queue → reconnect → server uses `COALESCE` per PR #81 sweep 2 (test: navigate, mark read offline, wait 2 minutes, reconnect; assert read_at = original-mark moment not flush moment).
- [ ] **T-09.7.3** Verify preferences toggle offline → queue → reconnect → server merge returns correct merged column.

## Phase 09.8 — Cleanup + verification

- [ ] **T-09.8.1** Run `01-design-system § Codemod` against new files.
- [ ] **T-09.8.2** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-09.8.3** 90% coverage on touched files.
- [ ] **T-09.8.4** Manual e2e:
  - Trigger streak milestone via test session completion → assert push delivered + bell badge increments + list row appears.
  - Open Preferences → toggle Streaks off → assert subsequent test trigger does NOT deliver.
  - Tap notification in list → assert mark-read + correct deep-link route.
  - Offline notifications browse → assert cached list renders.

---

## Acceptance gate (notifications phase complete)

- [ ] All 8 phases shipped as PRs.
- [ ] Backend (PR #81) consumed without modification.
- [ ] Push notifications deliver + tap-routes correctly.
- [ ] Bell badge accurate.
- [ ] Preferences toggle persists across cold-starts.
- [ ] Offline list browse works.
- [ ] Adding a new notification type follows the locked-decision-10 procedure (single PR with cross-cuts + spec + migration).

---

_End of `09-notifications-social/tasks.md` · 2026-05-28 (rewritten from scratch)_
