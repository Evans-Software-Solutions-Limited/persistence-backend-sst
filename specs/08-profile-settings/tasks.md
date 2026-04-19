# 08 — Profile & Settings: Tasks

## Current state (2026-04-19)

**Shipped: ~2 of ~40 tasks complete. Minimum viable skeleton.**

What's there:

- **Backend** — `GET /profiles/me` and `PATCH /profiles/me` handlers exist at `microservices/core/src/application/profiles/`. No avatar upload endpoint yet.
- **Mobile** — `ProfileContainer` exists but currently only exposes `signOut` + email from session. `ProfilePresenter` and a presenter test exist. `(tabs)/profile.tsx` renders the container. No editor, no preferences, no settings, no session history, no account actions.

Parent milestone: **M6 Profile + Edit profile** — expands `ProfileContainer` to legacy parity (stats, subscription badge, menu links, trainer promo banner conditional on role), adds `EditProfileContainer` + presenter, adds avatar picker via `expo-image-picker`. Backend brief verifies `GET/PATCH /profile` and adds `POST /profile/avatar` (multipart) if missing. Settings / preferences / history are likely to slide into later milestones or stay deferred until M11 polish.

## Phase 1: Domain

- [ ] Create `UserProfile`, `UserRole`, `FitnessLevel` models
- [ ] Create `AppPreferences`, `NotificationPreferences` models
- [ ] Define default preferences values
- [ ] Write tests for preference defaults and validation

## Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with profile CRUD and session history
- [ ] Extend `StoragePort` with profile cache, preferences, session history
- [ ] Implement preferences in AsyncStorage adapter
- [ ] Implement profile cache in SQLite
- [ ] Write adapter tests

## Phase 3: Application Layer

- [ ] Create `GetProfileQuery` (cache-first, background refresh)
- [ ] Create `UpdateProfileCommand` (save local, queue sync)
- [ ] Create `GetPreferencesQuery` (from AsyncStorage)
- [ ] Create `UpdatePreferencesCommand` (to AsyncStorage)
- [ ] Create `GetSessionHistoryQuery` (paginated, cache-first)
- [ ] Create `DeleteAccountCommand` (requires confirmation, calls API)
- [ ] Write tests

## Phase 4: UI — Profile

- [ ] Create `ProfilePresenter` (display name, email, role, avatar, fitness info)
- [ ] Create `ProfileContainer` (fetches profile)
- [ ] Create `ProfileEditorPresenter` (edit form: name, avatar, fitness level, equipment, accessibility)
- [ ] Create `ProfileEditorContainer` (form state, validation, save)
- [ ] Create `EquipmentPicker` component (multi-select grid)
- [ ] Create `FitnessLevelPicker` component (radio-style selector)
- [ ] Create screens: `app/(app)/(tabs)/profile.tsx`, `app/(app)/edit-profile.tsx`
- [ ] Write tests

## Phase 5: UI — Settings

- [ ] Create `PreferenceToggle` component (label, description, toggle/selector)
- [ ] Create `SettingsPresenter` (theme, units, rest timer, notifications, account actions)
- [ ] Create `SettingsContainer` (reads/writes preferences)
- [ ] Create screen: `app/(app)/settings.tsx`
- [ ] Write tests

## Phase 6: UI — Session History

- [ ] Create `SessionHistoryPresenter` (list of past sessions, date filter)
- [ ] Create `SessionHistoryDetailPresenter` (single session: exercises, sets, summary)
- [ ] Create `SessionHistoryContainer` (fetches, paginates)
- [ ] Create screens: `app/(app)/history/index.tsx`, `app/(app)/history/[id].tsx`
- [ ] Write tests

## Phase 7: Account Actions

- [ ] Implement change password flow (calls Supabase auth)
- [ ] Implement delete account with confirmation dialog
- [ ] Add links to privacy policy, terms, help centre
- [ ] Write tests

## Phase 8: Quality Gates

- [ ] All profile/settings tests pass with 90% coverage
- [ ] Quality gates pass
