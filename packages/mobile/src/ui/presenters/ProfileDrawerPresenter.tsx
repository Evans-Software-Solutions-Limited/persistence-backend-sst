import { Text, View } from "@tamagui/core";
import { useState } from "react";
import { Pressable } from "react-native";

import { Avatar, BottomSheet, Card, Pill } from "@/ui/components/foundation";
import type { PillTone } from "@/ui/components/foundation/tones";
import { DrawerRow } from "@/ui/components/composite";
import { DrawerSection } from "@/ui/components/profile/DrawerSection";
import {
  IconBell,
  IconChevronR,
  IconHealth,
  IconLogout,
  IconMedal,
  IconSettings,
  IconUser,
  iconDefaults,
} from "@/ui/components/icons";
import { toneHex } from "@/ui/components/foundation/tones";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import { ModeSwitchCardPresenter } from "./ModeSwitchCardPresenter";
import { SignOutConfirmDialog } from "./SignOutConfirmDialog";

/**
 * <ProfileDrawerPresenter> — the ProfileDrawer body (identity + mode-switch +
 * Account / Subscription / Preferences sections + sign-out).
 *
 * Spec: specs/08-profile-settings/design.md § <ProfileDrawerPresenter>
 *       + § Revised 2026-05-31 (real hooks / routes / tall height)
 *       specs/08-profile-settings/requirements.md STORY-001/002/004/005/006/007
 * Source: extra.jsx:7–108.
 *
 * Pure presenter — the container (ProfileDrawerContainer) owns all data +
 * navigation + the sign-out mutation. The mode-switch card renders only when
 * `isTrainerEligible` (STORY-003 AC 3.1).
 */

// Maps the live SubscriptionTierName union to the drawer's badge label.
// Returns null for free tier — caller skips rendering the badge.
export function tierBadge(tier: SubscriptionTierName): string | null {
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
export function tierPillTone(tier: SubscriptionTierName): PillTone {
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

function fmtDate(date: Date): string {
  // DD/MM/YYYY — matches the prototype's "Ends 01/06/2026".
  // Use UTC components: `expiresAt` is a UTC ISO timestamp, and reading it
  // via the local getters silently shifts the date back a day for any
  // negative-offset timezone (PR #94 medium-severity find).
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export type ProfileDrawerProfile = {
  name: string;
  email: string;
  initials: string;
  age: number | null;
  weightKg?: number;
};

export type ProfileDrawerSubscription = {
  tier: SubscriptionTierName;
  inTrial: boolean;
  expiresAt?: Date;
  planDescription: string;
};

export type ProfileDrawerPresenterProps = {
  visible: boolean;
  onClose: () => void;
  profile?: ProfileDrawerProfile;
  subscription?: ProfileDrawerSubscription;
  /** Undefined until 06-progress-goals ships useGetAchievements. */
  achievementsCount?: number;
  healthConnected?: boolean;
  mode: "athlete" | "coach";
  isTrainerEligible: boolean;
  /** Undefined until 10-trainer-features ships useTrainerClients. */
  clientCount?: number;
  isSigningOut?: boolean;
  onSwitchMode: (next: "athlete" | "coach") => void | Promise<void>;
  onOpenProfile: () => void;
  onOpenAchievements: () => void;
  onOpenHealth: () => void;
  onOpenSubscription: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void | Promise<void>;
};

// Join non-empty fragments with " · " — keeps "undefined · undefinedkg" out
// of the sub label when optional profile fields aren't filled in yet.
function profileDetailsSub(p: ProfileDrawerProfile): string {
  return [
    p.name,
    p.age != null ? String(p.age) : null,
    p.weightKg != null ? `${p.weightKg}kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ProfileDrawerPresenter({
  visible,
  onClose,
  profile,
  subscription,
  achievementsCount,
  healthConnected,
  mode,
  isTrainerEligible,
  clientCount,
  isSigningOut = false,
  onSwitchMode,
  onOpenProfile,
  onOpenAchievements,
  onOpenHealth,
  onOpenSubscription,
  onOpenNotifications,
  onOpenSettings,
  onSignOut,
}: ProfileDrawerPresenterProps) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // First-paint / cache-loading state — profile hasn't resolved yet.
  if (!profile) {
    return (
      <BottomSheet visible={visible} onClose={onClose} height="tall">
        <View
          flexDirection="row"
          alignItems="center"
          gap={14}
          marginBottom={16}
        >
          <Avatar initials="–" size={56} tone="primary" />
          <View flex={1}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={24}
              color="$text3"
            >
              Loading…
            </Text>
          </View>
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} height="tall">
      {/* Identity block — extra.jsx:30–41 */}
      <View flexDirection="row" alignItems="center" gap={14} marginBottom={16}>
        <Avatar
          initials={profile.initials}
          size={56}
          tone="primary"
          badge={mode === "coach" ? "COACH" : undefined}
        />
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={24}
            letterSpacing={-0.5}
            color="$text"
          >
            {profile.name}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {profile.email}
          </Text>
          <View flexDirection="row" gap={6} marginTop={6}>
            {subscription && tierBadge(subscription.tier) ? (
              <Pill tone={tierPillTone(subscription.tier)} size="xs">
                {tierBadge(subscription.tier) as string}
              </Pill>
            ) : null}
            {subscription?.inTrial ? (
              <Pill tone="ember" size="xs">
                7-DAY TRIAL
              </Pill>
            ) : null}
          </View>
        </View>
      </View>

      {/* Mode-switch card — only for trainer-eligible users (STORY-003 AC 3.1) */}
      {isTrainerEligible ? (
        <ModeSwitchCardPresenter
          mode={mode}
          clientCount={clientCount}
          onSwitch={onSwitchMode}
          testID="mode-switch-card"
        />
      ) : null}

      {/* Account section */}
      <DrawerSection title="Account">
        <DrawerRow
          icon={<IconUser {...iconDefaults({ size: 16 })} />}
          title="Profile details"
          sub={profileDetailsSub(profile)}
          onPress={onOpenProfile}
          testID="row-profile-details"
        />
        <DrawerRow
          icon={<IconMedal {...iconDefaults({ size: 16 })} />}
          title="Achievements"
          // Count omitted until 06-progress-goals ships useGetAchievements.
          sub={
            achievementsCount != null
              ? `${achievementsCount} of 12 unlocked`
              : "View your achievements"
          }
          trailing={
            achievementsCount != null ? (
              <Pill tone="gold" size="xs">
                {String(achievementsCount)}
              </Pill>
            ) : undefined
          }
          onPress={onOpenAchievements}
          testID="row-achievements"
        />
        <DrawerRow
          icon={<IconHealth {...iconDefaults({ size: 16 })} />}
          title="Health & integrations"
          sub={healthConnected ? "Apple Health connected" : "Not connected"}
          trailing={
            healthConnected ? (
              <View
                width={6}
                height={6}
                borderRadius={3}
                backgroundColor="$success"
                testID="health-connected-dot"
              />
            ) : undefined
          }
          onPress={onOpenHealth}
          testID="row-health"
        />
      </DrawerSection>

      {/* Subscription section — extra.jsx:78–91. Guarded so it disappears
          entirely when useMySubscription hasn't resolved. */}
      {subscription ? (
        <DrawerSection title="Subscription">
          <Card
            pad={16}
            radius={12}
            surface={1}
            onPress={onOpenSubscription}
            testID="subscription-card"
            accessibilityLabel="Manage subscription"
          >
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <View>
                <View
                  flexDirection="row"
                  gap={6}
                  alignItems="center"
                  marginBottom={4}
                >
                  <Pill tone={tierPillTone(subscription.tier)} size="xs">
                    {tierBadge(subscription.tier) ?? "FREE"}
                  </Pill>
                  {subscription.expiresAt ? (
                    <Text fontFamily="$body" fontSize={11} color="$text3">
                      Ends {fmtDate(subscription.expiresAt)}
                    </Text>
                  ) : null}
                </View>
                <Text fontFamily="$body" fontSize={13} color="$text2">
                  {subscription.planDescription}
                </Text>
              </View>
              <IconChevronR {...iconDefaults({ size: 16 })} color="#8A8A98" />
            </View>
          </Card>
        </DrawerSection>
      ) : null}

      {/* Preferences section */}
      <DrawerSection title="Preferences">
        <DrawerRow
          icon={<IconBell {...iconDefaults({ size: 16 })} />}
          title="Notifications"
          sub="Daily reminder · 7:00 AM"
          onPress={onOpenNotifications}
          testID="row-notifications"
        />
        <DrawerRow
          icon={<IconSettings {...iconDefaults({ size: 16 })} />}
          title="Settings"
          sub="Units · Theme · Privacy"
          onPress={onOpenSettings}
          testID="row-settings"
        />
      </DrawerSection>

      {/* Sign out — extra.jsx:98–104 */}
      <Pressable
        onPress={() => setConfirmSignOut(true)}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        testID="sign-out-row"
        style={({ pressed }) => ({
          marginTop: 12,
          paddingVertical: 14,
          borderWidth: 1,
          borderColor: "rgba(248,113,113,0.4)",
          borderRadius: 12,
          opacity: pressed ? 0.8 : 1,
          alignItems: "center",
          justifyContent: "center",
        })}
      >
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap={8}
        >
          <IconLogout
            {...iconDefaults({ size: 14 })}
            color={toneHex("error").base}
          />
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={13}
            color="$error"
          >
            Sign out
          </Text>
        </View>
      </Pressable>

      {confirmSignOut ? (
        <SignOutConfirmDialog
          isProcessing={isSigningOut}
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={onSignOut}
        />
      ) : null}
    </BottomSheet>
  );
}
