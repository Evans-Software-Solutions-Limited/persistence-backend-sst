# 09 — Notifications & Social: Tasks

> **Spec rewritten from scratch on 2026-05-28.** Prior tasks preserved in git history.

---

## Backend status

**Already shipped (PR #81, 2026-05-27):** 6 endpoints + JSONB preferences + atomic merge + COALESCE read-state semantics. No further backend work required for v1 frontend ship.

---

## Phase 09.1 — Domain + adapters (1 PR) — ✅ shipped 2026-06-07

> Reconciled to the shipped backend + V2 conventions (see the Revised
> 2026-06-07 banners in requirements.md / design.md). Also realigned the
> backend list endpoint offset → cursor (in-scope backend diff).

- [x] **T-09.1.1** Domain models in `packages/mobile/src/domain/models/`: `Notification` + `WireNotificationType`, `NotificationPreferences`, `NotificationType` union (9 producer-owned types), `CATEGORIES`/`DEFAULT_OPT_IN`. Implements requirements STORY-007.
- [x] **T-09.1.2** API port extensions in `domain/ports/api.port.ts` (6 methods + wire/input/result types).
- [x] **T-09.1.3** 6 endpoint wrappers on `SSTApiAdapter` (one-adapter-per-port convention) + `mapApiNotification` wire→domain mapping.
- [x] **T-09.1.4** SQLite cache (`cached_notifications` 100-row LRU + `cached_notification_preferences`) + StoragePort methods, per `design.md § SQLite cache schema`.
- [x] **T-09.1.5** Sync-queue commands for mark-read + mark-all-read + update-preferences (+ preferences response-capture branch in `sync.command.ts`).

## Phase 09.2 — Push token registration + listener (1 PR)

- [ ] **T-09.2.1** Author `adapters/notifications/expo-notifications.adapter.ts` per `design.md § Push notification listener`. Implements STORY-004 ACs.
- [ ] **T-09.2.2** Wire in `app/_layout.tsx` — register on auth + setup listeners.
- [ ] **T-09.2.3** Permission-denial graceful path — banner on Preferences screen.
- [ ] **T-09.2.4** Token re-registration on auth change + Expo token rotation event.

## Phase 09.3 — Notifications list screen — ✅ shipped 2026-06-07

- [x] **T-09.3.1** `<NotificationRowPresenter>` spec-local composite (36×36 tone tile + title + 2-line body + compact relative time + chevron) with a data-driven `notificationVisual` icon/tone map + forward-compatible fallback. STORY-002 AC 2.4, 2.5.
- [x] **T-09.3.2** `<NotificationsListPresenter>` — grouped sections (Today / Yesterday / This Week / Older) + **FlatList** (FlashList deferred to M11) + pull-to-refresh + `onEndReached` pagination. STORY-002.
- [x] **T-09.3.3** `<NotificationsListContainer>` — cache-first read (`getNotificationsQuery`) + background refresh + cursor pagination + optimistic mark-read / mark-all + tap→deep-link (09.6 hardens redirect/fallback).
- [x] **T-09.3.4** Route `(app)/notifications.tsx` + Stack registration.
- [x] **T-09.3.5** Empty state copy ("No notifications yet" / "Check back after a workout 💪").

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
