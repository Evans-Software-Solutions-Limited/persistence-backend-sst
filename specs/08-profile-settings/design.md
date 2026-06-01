# 08 — Profile & Settings: Design

> **Spec rewritten from scratch on 2026-05-27.** Pairs with `requirements.md`.

---

## Architecture overview

```
packages/mobile/
├── app/(app)/
│   ├── _layout.tsx                        ← mounts <ProfileDrawerContainer> driven by useDrawer (per 14)
│   └── profile/
│       ├── edit.tsx                       ← preserved (shell refresh)
│       ├── privacy.tsx                    ← preserved
│       ├── privacy-settings.tsx           ← preserved
│       ├── help.tsx                       ← preserved
│       ├── contact.tsx                    ← preserved
│       └── terms.tsx                      ← preserved
└── src/ui/
    ├── containers/
    │   ├── ProfileDrawerContainer.tsx     ← NEW
    │   ├── EditProfileContainer.tsx       ← preserved
    │   └── … (other sub-page containers preserved)
    └── presenters/
        ├── ProfileDrawerPresenter.tsx     ← NEW
        ├── ModeSwitchCardPresenter.tsx    ← NEW
        ├── EditProfilePresenter.tsx       ← preserved (shell refresh)
        └── … (other sub-page presenters preserved)
```

Drawer mounts at the `(app)/_layout.tsx` level (per `14-navigation` STORY-004 AC 4.2). Sub-pages stay where they are.

---

## `<ProfileDrawerContainer>` plumbing

```tsx
import { router } from "expo-router";
import { useDrawer } from "~/state/drawer";
import { useUserMode } from "~/state/user-mode";
import {
  useGetUserProfile,
  useGetUserSubscription,
  useGetAchievements,
  useGetHealthConnections,
  useTrainerClients,
  useSignOut,
} from "~/ui/hooks";

export function ProfileDrawerContainer() {
  const open = useDrawer((s) => s.open);
  const closeDrawer = useDrawer((s) => s.closeDrawer);
  const { mode, isTrainerEligible, switchTo } = useUserMode();

  const profile = useGetUserProfile();
  const subscription = useGetUserSubscription();
  const achievements = useGetAchievements();
  const healthConnections = useGetHealthConnections();
  const clients = useTrainerClients({ enabled: isTrainerEligible });
  const { mutateAsync: signOut } = useSignOut();

  return (
    <ProfileDrawerPresenter
      visible={open}
      onClose={closeDrawer}
      profile={profile.data}
      subscription={subscription.data}
      achievementsCount={achievements.data?.length}
      healthConnected={healthConnections.data?.some((c) => c.active)}
      mode={mode}
      isTrainerEligible={isTrainerEligible}
      clientCount={clients.data?.length}
      onSwitchMode={async (next) => {
        closeDrawer();
        await switchTo(next);
      }}
      onOpenProfile={() => {
        closeDrawer();
        router.push("/(app)/profile/edit");
      }}
      onOpenAchievements={() => {
        closeDrawer();
        router.push("/(app)/achievements");
      }}
      onOpenHealth={() => {
        closeDrawer();
        router.push("/(app)/profile/health");
      }}
      onOpenSubscription={() => {
        closeDrawer();
        router.push("/(app)/subscription-management");
      }}
      onOpenNotifications={() => {
        closeDrawer();
        router.push("/(app)/profile/notifications");
      }}
      onOpenSettings={() => {
        closeDrawer();
        router.push("/(app)/profile/privacy");
      }}
      onSignOut={async () => {
        await signOut();
      }}
    />
  );
}
```

---

## `<ProfileDrawerPresenter>`

Per `extra.jsx:7–108`.

```ts
import type { SubscriptionTierName } from "~/domain/models/subscription";

// Maps the live SubscriptionTierName union (free | premium | individual_trainer |
// small_business | medium_enterprise) to the drawer's badge label. Returns null
// for free tier — caller skips rendering the badge.
function tierBadge(tier: SubscriptionTierName): string | null {
  switch (tier) {
    case "free":
      return null;
    case "premium":
      return "PREMIUM";
    case "individual_trainer":
    case "small_business":
    case "medium_enterprise":
      return "TRAINER";
  }
}

// Pill tone for the same. Trainer tiers use violet; premium uses gold.
function tierPillTone(
  tier: SubscriptionTierName,
): "gold" | "trainer" | "neutral" {
  switch (tier) {
    case "free":
      return "neutral";
    case "premium":
      return "gold";
    case "individual_trainer":
    case "small_business":
    case "medium_enterprise":
      return "trainer";
  }
}

type ProfileDrawerProps = {
  visible: boolean;
  onClose: () => void;
  profile?: {
    name: string;
    email: string;
    initials: string;
    age?: number;
    weightKg?: number;
  };
  // Aligned to packages/mobile/src/domain/models/subscription.ts SubscriptionTierName.
  // "basic" was dropped during M10.5 tier simplification (CLAUDE.md: drops Basic,
  // drops Standard trainer variants, renames _pro → no suffix). The three trainer
  // variants are surfaced to the badge as the literal "trainer" via tierBadge() below.
  subscription?: {
    tier: SubscriptionTierName; // imported from ~/domain/models/subscription
    inTrial: boolean;
    expiresAt?: Date;
    planDescription: string;
  };
  achievementsCount?: number;
  healthConnected?: boolean;
  mode: "athlete" | "coach";
  isTrainerEligible: boolean;
  clientCount?: number;
  onSwitchMode: (next: "athlete" | "coach") => Promise<void>;
  onOpenProfile: () => void;
  onOpenAchievements: () => void;
  onOpenHealth: () => void;
  onOpenSubscription: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onSignOut: () => Promise<void>;
};
```

Render structure:

```tsx
// Render-time skeleton when profile hasn't resolved yet (first paint or 4xx-then-empty).
// Avatar gets initials "–", name + email render as skeleton blocks via DrawerRow's
// existing `loading` prop from 01-design-system STORY-004 AC 4.6.
if (!profile) {
  return (
    <BottomSheet visible={visible} onClose={onClose} height="default">
      <Row gap={14} mb={16}>
        <Avatar initials="–" size={56} tone="primary" />
        <Stack flex={1}>
          <Text variant="h1" color="$text3">
            Loading…
          </Text>
        </Stack>
        <IconBtn icon={<IconX size={16} />} tone="ghost" onPress={onClose} />
      </Row>
    </BottomSheet>
  );
}

// Helper: join non-empty fragments with separators. Keeps "undefined · undefinedkg"
// out of the sub label when optional profile fields aren't filled in yet.
const profileDetailsSub = (p: NonNullable<typeof profile>) =>
  [
    p.name,
    p.age != null ? String(p.age) : null,
    p.weightKg != null ? `${p.weightKg}kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

return (
  <BottomSheet visible={visible} onClose={onClose} height="default">
    {/* Identity block — extra.jsx:30–41 */}
    <Row gap={14} mb={16}>
      <Avatar
        initials={profile.initials}
        size={56}
        tone="primary"
        badge={mode === "coach" ? "COACH" : undefined}
      />
      <Stack flex={1}>
        <Text variant="h1">{profile.name}</Text>
        <Text variant="body" color="$text3" size={12}>
          {profile.email}
        </Text>
        <Row gap={6} mt={6}>
          {subscription && tierBadge(subscription.tier) && (
            <Pill tone={tierPillTone(subscription.tier)} size="xs">
              {tierBadge(subscription.tier)}
            </Pill>
          )}
          {subscription?.inTrial && (
            <Pill tone="ember" size="xs">
              7-DAY TRIAL
            </Pill>
          )}
        </Row>
      </Stack>
      <IconBtn icon={<IconX size={16} />} tone="ghost" onPress={onClose} />
    </Row>

    {/* Mode-switch card */}
    {isTrainerEligible && (
      <ModeSwitchCardPresenter
        mode={mode}
        clientCount={clientCount}
        onSwitch={onSwitchMode}
      />
    )}

    {/* Account section */}
    <DrawerSection title="Account">
      <DrawerRow
        icon={<IconUser size={16} />}
        title="Profile details"
        sub={profileDetailsSub(profile)}
        onPress={onOpenProfile}
      />
      <DrawerRow
        icon={<IconMedal size={16} />}
        title="Achievements"
        sub={
          achievementsCount != null
            ? `${achievementsCount} of 12 unlocked`
            : "—"
        }
        trailing={
          achievementsCount != null ? (
            <Pill tone="gold" size="xs">
              {achievementsCount}
            </Pill>
          ) : undefined
        }
        onPress={onOpenAchievements}
      />
    <DrawerRow
      icon={<IconHealth size={16} />}
      title="Health & integrations"
      sub={healthConnected ? "Apple Health connected" : "Not connected"}
      trailing={
        healthConnected ? (
          <View w={6} h={6} borderRadius={3} bg="$success" />
        ) : undefined
      }
      onPress={onOpenHealth}
    />
  </DrawerSection>

  {/* Subscription section — extra.jsx:78–91. Wrapped in `{subscription && …}`
      so the section disappears entirely when useGetUserSubscription hasn't
      resolved yet (independent of useGetUserProfile) or returned no row. The
      identity-block Pills at the top already use the same guard pattern. */}
  {subscription && (
    <DrawerSection title="Subscription">
      <Card pad={14} radius={12} surface={1} onPress={onOpenSubscription}>
        <Row alignItems="center" justifyContent="space-between">
          <Stack>
            <Row gap={6} alignItems="center" mb={4}>
              <Pill tone={tierPillTone(subscription.tier)} size="xs">
                {tierBadge(subscription.tier) ?? "FREE"}
              </Pill>
              {subscription.expiresAt && (
                <Text variant="body" color="$text3" size={11}>
                  Ends {fmtDate(subscription.expiresAt)}
                </Text>
              )}
            </Row>
            <Text variant="body" color="$text2" size={13}>
              {subscription.planDescription}
            </Text>
          </Stack>
          <IconChevronR size={16} color="$text3" />
        </Row>
      </Card>
    </DrawerSection>
  )}

  <DrawerSection title="Preferences">
    <DrawerRow
      icon={<IconBell size={16} />}
      title="Notifications"
      sub="Daily reminder · 7:00 AM"
      onPress={onOpenNotifications}
    />
    <DrawerRow
      icon={<IconSettings size={16} />}
      title="Settings"
      sub="Units · Theme · Privacy"
      onPress={onOpenSettings}
    />
  </DrawerSection>

  {/* Sign out */}
  <Pressable
    onPress={() => setConfirmSignOut(true)}
    style={{
      mt: 12,
      py: 14,
      bg: "transparent",
      borderWidth: 1,
      borderColor: "$border",
      borderRadius: 12,
    }}
  >
    <Row alignItems="center" justifyContent="center" gap={8}>
      <IconLogout size={14} color="$error" />
      <Text variant="display" weight={600} size={13} color="$error">
        Sign out
      </Text>
    </Row>
  </Pressable>

  {confirmSignOut && (
    <SignOutConfirmDialog
      onCancel={() => setConfirmSignOut(false)}
      onConfirm={onSignOut}
    />
  )}
</BottomSheet>
```

---

## `<DrawerSection>` — spec-local composite

Per `extra.jsx:110–117`. Trivial enough to live here, not in `01-design-system`.

```ts
type DrawerSectionProps = { title: string; children: ReactNode };

function DrawerSection({ title, children }) {
  return (
    <Stack mb={14}>
      <Text variant="eyebrow" color="$text3" mb={8} pl={4}>{title}</Text>
      <Stack gap={4}>{children}</Stack>
    </Stack>
  );
}
```

Lives at `packages/mobile/src/ui/components/profile/DrawerSection/`.

---

## `<ModeSwitchCardPresenter>`

Per `extra.jsx:44–69`.

```ts
type ModeSwitchCardProps = {
  mode: "athlete" | "coach";
  clientCount?: number;
  onSwitch: (next: "athlete" | "coach") => Promise<void>;
};
```

Layout: 38×38 icon tile (`$accentTrainerDim` bg, `$accentTrainer` fg, `<IconUsers>`) + title + sub + Btn. Card background gradients: athlete = `$surface2`, coach = `linear-gradient(135deg, $accentTrainerDim 0%, $surface2 100%)`. Border colour matches.

Title text varies by mode (per `extra.jsx:59`):

- Athlete: "Trainer Mode" / "Switch to manage your clients" / Btn "Switch" (filled trainer)
- Coach: "Coaching {N} clients" / "Athletes feel like normal users" / Btn "↔ Athlete" (soft trainer with `<IconSwap>`)

---

## `<SignOutConfirmDialog>` — spec-local

Same pattern as `05-active-session § <EndConfirmDialogPresenter>` — centred modal with blur backdrop.

```tsx
function SignOutConfirmDialog({ onCancel, onConfirm }) {
  return (
    <Pressable onPress={onCancel} style={fullScreenBackdrop}>
      <View onStartShouldSetResponder={() => true} style={dialogCard}>
        <Text variant="h1" mb={8}>
          Sign out?
        </Text>
        <Text variant="body" size={13} mb={16} color="$text2">
          You'll need to sign back in to access your workouts.
        </Text>
        <Row gap={10}>
          <Btn
            variant="outline"
            tone="primary"
            size="md"
            onPress={onCancel}
            flex={1}
          >
            Cancel
          </Btn>
          <Btn
            variant="filled"
            tone="error"
            size="md"
            onPress={onConfirm}
            flex={1}
          >
            Sign out
          </Btn>
        </Row>
      </View>
    </Pressable>
  );
}
```

---

## Sub-page shell refreshes

Each `(app)/profile/*` route gets shell-only updates:

- Replace `<View>` chrome with `<HeaderBar>` + `<Card>` + new tokens.
- All form inputs use `$surface2` bg, `$border` 1pt, `$md` radius.
- All buttons use `<Btn>` with appropriate variant/tone.
- Lucide icons replace Ionicons via the icon module from `01-design-system`.

No behavioural changes. No new endpoints.

---

## Backend impact

**None.**

Existing endpoints consumed:

| Method | Path                                                          |
| ------ | ------------------------------------------------------------- |
| GET    | `/users/me`                                                   |
| PUT    | `/users/me`                                                   |
| GET    | `/users/me/subscription`                                      |
| GET    | `/users/me/achievements` (from `06-progress-goals`)           |
| GET    | `/users/me/health-connections` (from `07-health-integration`) |
| POST   | `/auth/sign-out`                                              |

No migrations.

---

## Offline behaviour

- Drawer renders from cached profile / subscription / achievements / health-connections — all offline-safe.
- Edit-profile saves queue + optimistic.
- Sign-out requires online. Offline → toast: "Connect to internet to sign out."

---

## Testing strategy

### Unit tests

- `<ProfileDrawerPresenter>` — every section renders, mode-switch card conditional on `isTrainerEligible`, sign-out confirmation toggles.
- `<ModeSwitchCardPresenter>` — athlete + coach variants, switch button fires with correct target mode.
- `<SignOutConfirmDialog>` — both CTAs fire, backdrop cancels.
- Each preserved sub-page presenter — shell-refresh assertions.

### Integration tests

- Container opens drawer → tap each row → assert correct `router.push` + drawer close.
- Mode-switch: tap Switch → drawer closes → assert `useUserMode().mode` updates.
- Trainer-ineligible user → mode-switch card NOT rendered.
- Sign-out: tap → confirmation modal → confirm → assert mutation + navigation to `(auth)/sign-in`.

### Coverage

90% per `_agent.md`.

---

## Risks + mitigations

| Risk                                                                   | Mitigation                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sub-page push mid-drawer-close: animation conflict                     | `onOpen*` handlers close drawer FIRST then push. Animation handled by `@gorhom/bottom-sheet`.       |
| Mode-switch CTA's client-count subtext loads slowly                    | Optimistic copy ("Switch to manage your clients") until count resolves. CTA never blocked on count. |
| Sign-out offline causes inconsistent local state                       | Disable Btn when `!useIsOnline()`. Toast hints reconnection.                                        |
| Achievements row flickers (`useGetAchievements` initially `undefined`) | Hook returns `[]` default → count is `0` → row renders cleanly.                                     |
| Drawer artefact remains after mode swap                                | `onSwitchMode` closes drawer FIRST then calls `switchTo()`.                                         |

---

_End of `08-profile-settings/design.md` · 2026-05-27 (rewritten from scratch)_

---

## Revised 2026-05-31: implementation reconciliation (hook reality-map, route resolutions, DOB, tall height)

> This section reconciles the 2026-05-27 design (written ahead of implementation) with the **shipped** V2 codebase as it stands after `01-design-system` (#83) and `14-navigation` (#93) merged to `main`. The original sections above are preserved as the record of intent. Where this section and a section above disagree, **this section wins** for implementation. Authored as the spec-first commit(s) on `feat/08-profile-settings` before any drawer code.

### A. Hook reality-map (supersedes `§ Plumbing` imports)

The original plumbing imports a set of `useGet*` hooks from `~/ui/hooks` that were named aspirationally. The real hooks shipped in V2 differ. Build against the **real** column:

| `design.md` (aspirational)           | Real hook (verified in `src/ui/hooks`)                         | Return shape + derivation                                                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useGetUserProfile()` → `.data`      | `useProfilePage()`                                             | `{ payload, isStale, isRefreshing, error, refresh }`. Profile fields live at `payload.profile` (`fullName`, `email`, `avatarUrl`, `weightKg`, `heightCm`, `dateOfBirth` — see § C). No `initials` field → derive from `fullName`.                                                    |
| `useGetUserSubscription()` → `.data` | `useMySubscription()`                                          | React Query `{ data: MySubscription, … }`. Map: `tier ← tierName`; `inTrial ← trialEndsAt != null && Date.parse(trialEndsAt) > Date.now()`; `expiresAt ← expiresAt` (ISO `string`, parse to Date at the edge); `planDescription ← tierDescription`. `isTrainerTier` already present. |
| `useSignOut()` (mutation)            | `useAuth().signOut`                                            | `signOut(): Promise<void>` from the auth context. No `mutateAsync` wrapper — call directly. Clears Supabase session + local cache + routes to `(auth)/sign-in` internally.                                                                                                           |
| `useGetAchievements()`               | **does not exist** (owned by `06-progress-goals`, not shipped) | Stub. See § B. Row renders without a live count.                                                                                                                                                                                                                                     |
| `useGetHealthConnections()`          | `useHealthData()`                                              | No "connections" array. `healthConnected ← isAvailable && (permissionStatus.steps === 'granted' \|\| permissionStatus.bodyWeight === 'granted')`. See § B for the row's route.                                                                                                       |
| `useTrainerClients()`                | **does not exist** (M8 / `10-trainer-features`)                | Mode-switch card defaults to "your clients" with no count — already matches STORY-003 AC 3.6. Do not import; pass `clientCount={undefined}`.                                                                                                                                         |
| avatar upload                        | `useAvatarUpload()`                                            | Exists. Edit-profile sub-page (08.3) consumes it; the drawer identity block is read-only.                                                                                                                                                                                            |
| `usePostUpdateProfile()`             | `api.updateProfile(Partial<ApiProfile>)`                       | No dedicated hook — `EditProfileContainer` calls the adapter directly (PATCH `/profile`). Follow the existing container pattern for 08.3.                                                                                                                                            |

`initials` derivation (shared util): take the first letter of the first two whitespace-split tokens of `fullName`, uppercased; fall back to `"–"` when `fullName` is null/empty. (Matches the avatar-initials behaviour 14 already uses in headers.)

### B. Route resolutions (supersedes the `router.push` targets in `§ Plumbing` + STORY-004/005/006)

Four push targets in the original design point at routes that **do not exist** in the shipped tree (they would 404). Per owner decision (2026-05-31), follow the `14-navigation` `ComingSoon` precedent rather than dead-end:

| Row / card            | Original target                  | Shipped resolution (2026-05-31)                                                                                                                                                                                                |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile details       | `/(app)/profile/edit`            | **unchanged** — route exists. ✓                                                                                                                                                                                                |
| Achievements          | `/(app)/achievements`            | **render the row, stub the count.** Keep the push to `/(app)/achievements` (06 will create the route). Until 06 ships, the row has no trailing `<Pill>` and sub reads a static placeholder. Flag `// TODO(06-progress-goals)`. |
| Health & integrations | `/(app)/profile/health`          | `router.push('/(app)/coming-soon?feature=health')` until `07` ships a profile health sub-route. Status dot still reflects `useHealthData()` live.                                                                              |
| Notifications         | `/(app)/profile/notifications`   | `router.push('/(app)/coming-soon?feature=notifications')` until `09` ships. Static sub copy.                                                                                                                                   |
| Settings              | `/(app)/profile/privacy`         | **unchanged** — route exists. ✓                                                                                                                                                                                                |
| Subscription card     | `/(app)/subscription-management` | `router.push('/(app)/coming-soon?feature=subscription')` — the `subscription-management` route was never created; `coming-soon?feature=subscription` is the existing V2 pattern (see `app/(app)/coming-soon.tsx`).             |

`coming-soon.tsx` already declares a `subscription` feature key; add `health` + `notifications` keys to its copy map as part of 08.1 (trivial, additive — the screen is 14-owned infra but the copy table is open for additions).

### C. DOB / age (supersedes STORY-004 AC 4.1's "{name} · {age} · {weight}" + `§ Backend impact: None`)

**Owner decision (2026-05-31): the locked "Backend impact: None" decision (requirements decision-table #—, design `§ Backend impact`) is explicitly UNLOCKED for this one addition.** The original "no backend" property is superseded; `08` now carries a small backend migration. This shifts `08` out of the pure mobile-only lane in the ROADMAP fan-out — flag in the PR.

Rationale: STORY-004 AC 4.1 renders age in the Profile-details sub, but `ProfilePageData` has no date-of-birth/age field. Rather than drop age, add DOB at the source.

Scope of the DOB addition (each its own commit, backend-first):

1. **Backend** — add `date_of_birth DATE NULL` to the `profiles` table (migration). Extend the `GET /profile/page` aggregation (`profileRepository`) + the `PATCH /profile` accepted body to read/write it. Surface `dateOfBirth: string | null` (ISO date) on the `ProfilePageProfile` wire shape.
2. **Mobile domain** — add `dateOfBirth: string | null` to `ProfilePageProfile` (`domain/models/profilePage.ts`) + `ApiProfile`.
3. **Derivation** — **store DOB, derive age.** Never persist a computed age. `age ← computeAge(dateOfBirth, now)` (whole years; null when DOB unset) in a pure `shared/utils` helper with unit tests (leap-year + pre/post-birthday boundary cases).
4. **Edit form (08.3)** — add a DOB picker field to `EditProfilePresenter`; write via `api.updateProfile({ dateOfBirth })`.
5. **Drawer sub** — `profileDetailsSub` (already drop-safe) renders `name · {age} · {weight}` when DOB is set, gracefully `name · {weight}` until the user fills it in.

Because this crosses into the backend, the DOB commits depend on the core service. If the backend slice can't land in the 08 window, ship the drawer with `profileDetailsSub` rendering `name · weight` (age omitted) and land DOB as an immediate follow-up — the helper handles both states with no further drawer change.

### D. Drawer height — use `tall` (88%)

Locked decision #2 (88%) is now satisfiable: `01-design-system § Revised 2026-05-31` added a `tall` (88%) named height to `<BottomSheet>`. The drawer passes `height="tall"`. (The original render block's `height="default"` is superseded.)

### E. Mode-switch — call the shipped `useModeSwitch` hook

The original `onSwitchMode` handler inlines `closeDrawer()` then `await switchTo(next)`. `14-navigation` shipped `useModeSwitch()` (`src/ui/hooks/useModeSwitch.ts`, tested) which owns the **atomic** close → switch → tab-remap sequence (AC 3.7 — no flash of the wrong tabs, and the equivalent-tab remap the inline version omits). The container must call `useModeSwitch().switchMode(next, activeRoute)` rather than re-implementing the sequence. The `ModeSwitchCardPresenter` stays pure (receives `onSwitch`); the container wires `onSwitch` to `switchMode`.

### F. `<DrawerRow>` import path

`<DrawerRow>` ships at `~/ui/components/composite` (not `foundation`). Props match the design (`icon`, `title`, `sub`, `trailing`, `onPress`, `loading`). Import from `@/ui/components/composite`. `<DrawerSection>` remains spec-local (08-owned) per the original § above.

### G. Revised plumbing (authoritative)

```tsx
import { router } from "expo-router";
import { useDrawer } from "@/state/drawer";
import { useUserMode } from "@/state/user-mode";
import { useModeSwitch } from "@/ui/hooks/useModeSwitch";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useAuth } from "@/ui/hooks/useAuth";
import { initialsOf } from "@/shared/utils/initials";
import { computeAge } from "@/shared/utils/age";

export function ProfileDrawerContainer() {
  const open = useDrawer((s) => s.open);
  const closeDrawer = useDrawer((s) => s.closeDrawer);
  const { mode, isTrainerEligible } = useUserMode();
  const { switchMode } = useModeSwitch();

  const { payload } = useProfilePage();
  const profile = payload?.profile;
  const { data: subscription } = useMySubscription();
  const health = useHealthData();
  const { signOut } = useAuth();

  const healthConnected =
    health.isAvailable &&
    (health.permissionStatus.steps === "granted" ||
      health.permissionStatus.bodyWeight === "granted");

  return (
    <ProfileDrawerPresenter
      visible={open}
      onClose={closeDrawer}
      profile={
        profile
          ? {
              name: profile.fullName ?? "",
              email: profile.email ?? "",
              initials: initialsOf(profile.fullName),
              age: computeAge(profile.dateOfBirth), // null until DOB lands / set
              weightKg: profile.weightKg ?? undefined,
            }
          : undefined
      }
      subscription={
        subscription
          ? {
              tier: subscription.tierName,
              inTrial:
                subscription.trialEndsAt != null &&
                Date.parse(subscription.trialEndsAt) > Date.now(),
              expiresAt: subscription.expiresAt
                ? new Date(subscription.expiresAt)
                : undefined,
              planDescription: subscription.tierDescription ?? "",
            }
          : undefined
      }
      achievementsCount={undefined} // TODO(06-progress-goals): wire useGetAchievements
      healthConnected={healthConnected}
      mode={mode}
      isTrainerEligible={isTrainerEligible}
      clientCount={undefined} // TODO(10-trainer-features): wire useTrainerClients
      onSwitchMode={(next) => switchMode(next /*, activeRoute */)}
      onOpenProfile={() => {
        closeDrawer();
        router.push("/(app)/profile/edit");
      }}
      onOpenAchievements={() => {
        closeDrawer();
        router.push("/(app)/achievements"); // 06 creates the route
      }}
      onOpenHealth={() => {
        closeDrawer();
        router.push("/(app)/coming-soon?feature=health");
      }}
      onOpenSubscription={() => {
        closeDrawer();
        router.push("/(app)/coming-soon?feature=subscription");
      }}
      onOpenNotifications={() => {
        closeDrawer();
        router.push("/(app)/coming-soon?feature=notifications");
      }}
      onOpenSettings={() => {
        closeDrawer();
        router.push("/(app)/profile/privacy");
      }}
      onSignOut={async () => {
        await signOut();
      }}
    />
  );
}
```

`switchMode` already calls `closeDrawer()` internally, so `onSwitchMode` must NOT close the drawer itself (double-close is harmless but redundant). The `activeRoute` arg is optional — pass the current tab route name if the drawer can read it from navigation state; otherwise the hook defaults to `index` and the remap still lands on a valid tab.

### H. Sub-page inventory check (08.3)

Shipped routes under `app/(app)/profile/`: `edit`, `privacy`, `privacy-settings`, `help`, `contact`, `terms`. **No `notifications` and no `health` sub-route exists** (consistent with § B). 08.3's shell refresh covers the six that exist; it does NOT create the two missing ones (owned by 09 / 07). Also apply `insets.top` to each sub-page `<HeaderBar>` per the `14-navigation/SMOKE_TEST.md` top-inset known-issue — and prefer the `01-design-system` `<HeaderBar>` inset amendment flagged there if it lands, which fixes Train + every consumer at once.

---

_Revised 2026-05-31 — implementation reconciliation against shipped `main` (#83 + #93). Supersedes the 2026-05-27 plumbing/route/backend assumptions where they conflict._

---

## Revised 2026-05-31 (b): offline-first profile write + PR #94 review fixes

> Follow-up within the same PR after review. Closes the long-standing
> STORY-009 AC 9.2 gap and the three bot-review findings.

### I. Edit-profile save is now offline-first (closes STORY-009 AC 9.2)

The 2026-05-27 design (and the shipped M6 code) had `EditProfileContainer` call `api.updateProfile` **directly** — a bare `PATCH /profile` that failed hard offline, with no queue and no optimistic write. That always contradicted STORY-009 AC 9.2 ("edit-profile saves queue + optimistic per V2 pattern"); the gap predates this spec but is closed here per owner decision (reads were already offline-first; writes now match).

New `updateProfileCommand` (`application/commands/update-profile.command.ts`) mirrors `updateWorkoutCommand`:

1. **Validate** the patch (DOB format) BEFORE enqueueing — the sync worker POSTs queued payloads with no feedback loop, so a bad value must never reach the queue (see § J bug 2).
2. **Optimistic cache write** — merge the patch into the cached `/profile/page` payload (`storage.cacheProfilePage`) so the drawer (`useProfilePage`) + edit form reflect the change immediately and across an app restart, until the queue drains.
3. **Enqueue** a `{ entityType: "profile", endpoint: "/profile", method: "PATCH" }` mutation.

`EditProfileContainer` calls the command (not the adapter) + fires an inline `processSyncQueue` drain for immediacy (mirrors `WorkoutRatingContainer`). The drain is **not awaited** — Save must not block on the network. The generic `useSyncWorker` (mounted at the `(app)` auth boundary) already drains any `entityType` on mount + foreground, so a save made offline replays automatically on reconnect; no new mount point was needed. `useAuth.signOut` already clears the queue + caches, so there's no cross-account bleed surface.

The direct `api.updateProfile` path is retired for the edit form. (The adapter method stays on `ApiPort` — `PrivacySettingsContainer` still uses it for its single-toggle write; converting that is out of scope here.)

### J. PR #94 review fixes

1. **(High) Clearing DOB → 422.** `PATCH /profile` schema was `t.Optional(t.String())`, which rejects an explicit `null`, so the "unset my DOB" path was unreachable. Widened to `t.Optional(t.Union([t.String(), t.Null()]))` + backend test.
2. **(Med) Malformed DOB → 500.** `profiles.date_of_birth` is a Postgres `DATE`; an unparseable string crashed the `UPDATE`. Now validated in two places: client-side in `updateProfileCommand` (keeps bad dates out of the offline queue) via `shared/utils/date.isIsoDateString`, and server-side in the handler (structured 400 instead of a 500) via a matching `isValidIsoDate` guard. Both reject shape errors, impossible months/days, and non-leap Feb 29.
3. **(Med) `fmtDate` timezone day-shift.** The drawer's subscription-expiry used local-time getters on a UTC ISO timestamp, shifting the date back a day for negative-offset timezones. Switched to `getUTC*` getters + a timezone-independent presenter test.

---

_Revised 2026-05-31 (b) — offline-first profile write (AC 9.2) + PR #94 fixes._
