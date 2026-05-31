import { Text, View } from "@tamagui/core";

import { useDrawer } from "@/state/drawer";
import { BottomSheet } from "@/ui/components/foundation";

/**
 * <ProfileDrawerContainer> — the ProfileDrawer mount-point.
 *
 * Spec: specs/14-navigation/design.md § <ProfileDrawer> mount-point
 *       specs/14-navigation/requirements.md STORY-004 (AC 4.2, 4.3)
 *       specs/14-navigation/tasks.md T-14.5.1
 *
 * This spec (14-navigation) owns ONLY the mount-point + the open-state
 * wiring: the container is ALWAYS mounted at (app)/_layout.tsx and drives the
 * <BottomSheet>'s `visible` prop from `useDrawer().open`, so a parent-driven
 * close animates DOWN (250ms slide) instead of unmounting synchronously.
 *
 * The drawer BODY — identity card, mode-switch card, account / subscription /
 * preferences sections, sign-out — is owned by `08-profile-settings`, which
 * replaces the placeholder below with the real composition. Until then this
 * renders a minimal "coming soon" body so the open/close + backdrop-tap
 * mechanics are exercisable end-to-end (the avatar trigger from any header
 * opens it via `useDrawer().openDrawer`).
 */
export function ProfileDrawerContainer() {
  const open = useDrawer((s) => s.open);
  const closeDrawer = useDrawer((s) => s.closeDrawer);

  return (
    <BottomSheet
      visible={open}
      onClose={closeDrawer}
      eyebrow="PROFILE"
      title="Account"
      testID="profile-drawer"
    >
      {/* Placeholder body — composed by 08-profile-settings. */}
      <View gap={8} testID="profile-drawer-placeholder">
        <Text fontFamily="$body" fontSize={14} color="$text2">
          Your profile, subscription and preferences live here.
        </Text>
        <Text fontFamily="$body" fontSize={12} color="$text3">
          Account management arrives with 08-profile-settings.
        </Text>
      </View>
    </BottomSheet>
  );
}
