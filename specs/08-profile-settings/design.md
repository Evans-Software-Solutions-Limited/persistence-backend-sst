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
      sub={`${profile.name} · ${profile.age} · ${profile.weightKg}kg`}
      onPress={onOpenProfile}
    />
    <DrawerRow
      icon={<IconMedal size={16} />}
      title="Achievements"
      sub={`${achievementsCount} of 12 unlocked`}
      trailing={
        <Pill tone="gold" size="xs">
          {achievementsCount}
        </Pill>
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

  {/* Subscription section — extra.jsx:78–91 */}
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
