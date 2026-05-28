# 08 — Profile & Settings: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package. Prior version preserved in git history.

---

## Overview

The user's profile lives in a **bottom-sheet drawer** mounted at the `(app)` layout level — not a tab. Avatar tap from any screen header opens the drawer. The drawer holds identity, mode switching (when trainer-eligible), account links, subscription summary, preferences, and sign-out. Sub-pages (edit profile, privacy, help, contact, terms) push from drawer rows onto the navigation stack.

Authoritative references:

1. `~/Downloads/handoff/design-source/screens/extra.jsx` lines 7–108 — `ProfileDrawer` (canonical pattern for Option 3 nav)
2. `~/Downloads/handoff/design-source/screens/extra.jsx` lines 144–185 — `ProfileScreen` (full-screen alternative — NOT used in V2 since we adopted Option 3)
3. `specs/14-navigation/design.md § <ProfileDrawer> mount-point` — drawer mounts under `(app)/_layout.tsx`; `useDrawer` Zustand slice owns open-state
4. `specs/_shared/cross-cuts.md` (drawer mentions trainer mode + COACH badge)
5. `docs/design-port-audit.md` § "Profile drawer"
6. Legacy V1 reference: `../persistence-mobile/app/(tabs)/profile.tsx`, `app/edit-profile.tsx`, etc.

---

## Locked decisions

| #   | Decision                    | Locked value                                                                                                                                                  |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Profile location            | Bottom-sheet drawer mounted at `(app)/_layout.tsx`. No Profile tab.                                                                                           |
| 2   | Drawer max height           | 88% of screen height (per `extra.jsx:23`). `peek` variant 60% reserved for future use.                                                                        |
| 3   | Avatar size in drawer       | 56pt (per `extra.jsx:31`). COACH badge bottom-right when `mode === 'coach'`.                                                                                  |
| 4   | Mode-switch card            | Only renders when `useUserMode().isTrainerEligible === true`. Calls `useUserMode().switchTo('coach'                                                           | 'athlete')`. |
| 5   | Sub-pages                   | All existing V2 sub-routes preserved: `(app)/profile/{edit, privacy, privacy-settings, help, contact, terms}`. Drawer rows route into them via `router.push`. |
| 6   | Sign-out CTA                | Full-width outline error-tinted Btn at the bottom of the drawer. Confirmation step preserved from V2.                                                         |
| 7   | Drawer state                | Owned by `useDrawer` Zustand slice from `14-navigation`. Open via `openDrawer()`, close via `closeDrawer()`. Backdrop tap closes.                             |
| 8   | No tabs ever show "Profile" | The legacy `Profile` tab in `(tabs)/_layout.tsx` is removed by `14-navigation` STORY-001.                                                                     |
| 9   | Achievements row count      | Reads `useGetAchievements()` from `06-progress-goals`. Total / unlocked rendered as `<Pill tone="gold" size="xs">N</Pill>`.                                   |
| 10  | Health integrations row     | Reads `useGetHealthConnections()` (`07-health-integration`). Renders `$success` dot when ≥1 connection active.                                                |

---

## User stories

### STORY-001: As a user, I want to open my profile from any screen by tapping my avatar

**Acceptance Criteria:**

- 1.1 [ ] Every screen header that uses `<HeaderBar>` from `01-design-system` accepts a `leading={<Avatar onPress={openDrawer}/>}` slot (per `14-navigation` STORY-004 AC 4.4). Implementation patterns established in 14.
- 1.2 [ ] Avatar tap calls `useDrawer().openDrawer()`. The drawer overlays the active tab content.
- 1.3 [ ] Drawer slide-up animation: ~250ms ease-in-out from bottom (per `@gorhom/bottom-sheet` v4 defaults from `01-design-system § <BottomSheet>`).
- 1.4 [ ] Backdrop tap closes the drawer. Drag-down gesture closes. ESC on web closes.

### STORY-002: As a user, I want to see my identity at the top of the drawer with my name, email, and subscription badges

**Acceptance Criteria:**

- 2.1 [ ] Identity block per `extra.jsx:30–41`: 56pt `<Avatar initials={initials} tone="primary" badge={mode==='coach' ? 'COACH' : undefined}/>` + name (display-h1) + email (`$text3` body 12pt) + pills row + close `<IconBtn icon={<IconX/>}/>`.
- 2.2 [ ] Pills row shows: `<Pill tone="gold" size="xs">PREMIUM</Pill>` if `subscriptionTier === 'premium'`; `<Pill tone="ember" size="xs">7-DAY TRIAL</Pill>` if `inTrial === true`.
- 2.3 [ ] Tier + trial state come from `useGetUserSubscription()` (existing).

### STORY-003: As a trainer-eligible user, I want a clear mode-switch card so I can flip between athlete and coach without leaving the drawer

**Acceptance Criteria:**

- 3.1 [ ] Card only renders when `useUserMode().isTrainerEligible === true`. Layout per `extra.jsx:44–69`.
- 3.2 [ ] Background gradients shift by current mode: athlete → `$surface2` + `$border`; coach → `linear-gradient(135deg, $accentTrainerDim 0%, $surface2 100%)` + `$accentTrainerDim` border.
- 3.3 [ ] Athlete-mode card text: title "Trainer Mode" + sub "Switch to manage your clients" + CTA `<Btn variant="filled" tone="trainer" size="sm">Switch</Btn>`.
- 3.4 [ ] Coach-mode card text: title "Coaching {N} clients" + sub "Athletes feel like normal users" + CTA `<Btn variant="soft" tone="trainer" size="sm" icon={<IconSwap/>}>Athlete</Btn>`.
- 3.5 [ ] Tap on CTA: closes drawer (`closeDrawer()`), then calls `useUserMode().switchTo()`. Tab bar accent + spec swaps per `14-navigation` STORY-003.
- 3.6 [ ] Client count source: `useTrainerClients()` (M8) — until M8 lands, defaults to "your clients" without a count.

### STORY-004: As a user, I want quick access to account links — profile details, achievements, health integrations

**Acceptance Criteria:**

- 4.1 [ ] "Account" `<DrawerSection>` per `extra.jsx:72–76` renders three `<DrawerRow>`s (from `01-design-system`):
  - Profile details → `router.push('/(app)/profile/edit')`; sub: "{name} · {age} · {weight}"
  - Achievements → `router.push('/(app)/achievements')` (renders the achievements grid — owned by `06-progress-goals`); trailing `<Pill tone="gold" size="xs">{count}</Pill>`; sub: "N of M unlocked"
  - Health & integrations → `router.push('/(app)/profile/health')`; sub: "Apple Health connected" (or "Not connected"); trailing `$success` 6×6 dot when ≥1 connection
- 4.2 [ ] Counts + sub-text reflect live data from existing V2 hooks (`useGetUserProfile`, `useGetAchievements`, `useGetHealthConnections`).

### STORY-005: As a user, I want a clear subscription summary in the drawer

**Acceptance Criteria:**

- 5.1 [ ] "Subscription" `<DrawerSection>` per `extra.jsx:78–91` renders a single `<Card>` containing the tier pill + expiry date + plan description + chevron.
- 5.2 [ ] Tap the card → `router.push('/(app)/subscription-management')` (existing V2 route from M10.5 W2).
- 5.3 [ ] Tier pill: `<Pill tone="gold" size="xs">PREMIUM</Pill>` or `<Pill tone="neutral" size="xs">BASIC</Pill>` etc.
- 5.4 [ ] Expiry date: "Ends DD/MM/YYYY". Description: short plan summary ("Unlimited workouts · AI coach · Macros" for Premium).

### STORY-006: As a user, I want access to preferences — notifications + settings

**Acceptance Criteria:**

- 6.1 [ ] "Preferences" `<DrawerSection>` per `extra.jsx:93–96` renders:
  - Notifications → `router.push('/(app)/profile/notifications')` (owned by `09-notifications-social`); sub: "{cadence}" (e.g. "Daily reminder · 7:00 AM")
  - Settings → `router.push('/(app)/profile/privacy')`; sub: "Units · Theme · Privacy"

### STORY-007: As a user, I want to sign out from the drawer

**Acceptance Criteria:**

- 7.1 [ ] Full-width sign-out button at the bottom per `extra.jsx:98–104`: `<Pressable>` styled as outline-error-tinted, `<IconLogout size={14}/> Sign out` label.
- 7.2 [ ] Tap shows confirmation modal: "Sign out?" + "Cancel" / "Sign out" (filled error).
- 7.3 [ ] Confirm fires `useSignOut()` (existing) — clears Supabase session, clears local SQLite cache, navigates to `(auth)/sign-in`.
- 7.4 [ ] Sub-pages preserved: `edit`, `privacy`, `privacy-settings`, `help`, `contact`, `terms`. Each gets a token + primitive refresh but no structural change.

### STORY-008: As a user, I want sub-pages (edit profile, privacy, help, contact, terms) styled with the new design system

**Acceptance Criteria:**

- 8.1 [ ] `(app)/profile/edit.tsx` — name, email, age, weight, height fields. Uses new `<TextInput>` styling + `<HeaderBar>` + `<Btn>` Save. Mutation: `usePostUpdateProfile()` (existing).
- 8.2 [ ] `(app)/profile/privacy.tsx` — settings list (units, theme, privacy toggles). Uses `<DrawerRow>` pattern.
- 8.3 [ ] `(app)/profile/privacy-settings.tsx` — fine-grained privacy toggles. Same pattern.
- 8.4 [ ] `(app)/profile/help.tsx` — help/FAQ links. `<DrawerRow>` list.
- 8.5 [ ] `(app)/profile/contact.tsx` — contact support form. `<HeaderBar>` + `<TextInput>` + `<Btn>`.
- 8.6 [ ] `(app)/profile/terms.tsx` — terms of service (and privacy-policy). Long-form scroll.
- 8.7 [ ] All sub-pages preserved as existing routes — they DO NOT move. Drawer rows route into them.

### STORY-009: As an offline user, the drawer still renders my profile + cached subscription state

**Acceptance Criteria:**

- 9.1 [ ] Drawer reads all data via cached hooks (`useGetUserProfile`, `useGetUserSubscription`, etc.) — already offline-safe in V2.
- 9.2 [ ] Edit-profile saves queue + optimistic per V2 pattern.
- 9.3 [ ] Sign-out: requires online (Supabase session-clear). If offline, surfaces "Connect to internet to sign out" toast.

---

## Out of scope

- **Coach Home / Coach screen content** — owned by `10-trainer-features`. This spec ships the mode-switch UI in the drawer; the coach screens it routes to are downstream.
- **Achievements grid + detail screens** — owned by `06-progress-goals`. This spec routes to them.
- **Notifications preferences screen content** — owned by `09-notifications-social`. This spec routes to it.
- **Health integration toggles** — owned by `07-health-integration`. This spec shows the row + status.
- **Subscription management screen** — owned by `11-payments-subscriptions`. Existing V2 route preserved.
- **Backend additions** — none.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                        | What's consumed                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-design-system`          | `<Avatar>`, `<Card>`, `<Btn>`, `<IconBtn>`, `<Pill>`, `<BottomSheet>`, `<DrawerRow>`, `<Section>` (for sub-page headers), Lucide icons, tokens |
| `14-navigation`             | `useDrawer` slice (open-state); `useUserMode` slice (mode + eligibility); drawer mount-point at `(app)/_layout.tsx`                            |
| `06-progress-goals`         | `useGetAchievements()` for the Achievements row count                                                                                          |
| `07-health-integration`     | `useGetHealthConnections()` for the health row status                                                                                          |
| `11-payments-subscriptions` | `useGetUserSubscription()` for tier + expiry; existing `/(app)/subscription-management` route                                                  |

**Unlocks:**

| Downstream spec       | What it can do once 08 lands                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `10-trainer-features` | Mode-switch from drawer triggers coach-mode tab spec via `useUserMode().switchTo('coach')`                  |
| Every screen          | Avatar trigger pattern is documented for downstream specs to consume (per `14-navigation` STORY-004 AC 4.4) |

---

## Open questions

None. All 10 decisions locked.

---

_End of `08-profile-settings/requirements.md` · 2026-05-27 (rewritten from scratch)_
