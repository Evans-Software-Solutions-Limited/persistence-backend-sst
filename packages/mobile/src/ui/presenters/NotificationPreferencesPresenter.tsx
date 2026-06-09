import { Text, View } from "@tamagui/core";
import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NotificationType } from "@/domain/models/notification";
import {
  CATEGORIES,
  isTypeEnabled,
  type NotificationPreferences,
} from "@/domain/models/notification-preferences";
import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { Section } from "@/ui/components/composite/Section";
import { IconAlert, IconBack } from "@/ui/components/icons";
import { NotificationPreferenceRow } from "@/ui/components/notifications/NotificationPreferenceRow";
import { color } from "@/ui/theme/tokens";

/**
 * <NotificationPreferencesPresenter> — categorized per-type opt-in toggles.
 * Follows the 08-profile-settings sub-page shell (HeaderBar + back +
 * scrollable body). Shows a permission-denial banner when OS notifications
 * are off (tap → open device Settings).
 *
 * Spec: specs/09-notifications-social/design.md § NotificationPreferencesPresenter
 *       requirements.md STORY-003
 */

export type NotificationPreferencesProps = {
  preferences: NotificationPreferences;
  onToggle: (type: NotificationType, enabled: boolean) => void;
  permissionGranted: boolean;
  onOpenSettings: () => void;
  onBack: () => void;
};

export function NotificationPreferencesPresenter({
  preferences,
  onToggle,
  permissionGranted,
  onOpenSettings,
  onBack,
}: NotificationPreferencesProps) {
  const insets = useSafeAreaInsets();

  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <HeaderBar
        title="Notifications"
        leading={
          <IconBtn
            icon={<IconBack size={18} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
          gap: 20,
        }}
      >
        {!permissionGranted ? (
          <Pressable
            testID="notifications-permission-banner"
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Open device notification settings"
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={10}
              backgroundColor="$goldDim"
              borderColor="$gold"
              borderWidth={1}
              borderRadius={12}
              padding={12}
            >
              <IconAlert size={18} color={color.$gold} />
              <Text flex={1} fontFamily="$body" fontSize={13} color="$text">
                Notifications are off in your device settings. Tap to open
                Settings and turn them on.
              </Text>
            </View>
          </Pressable>
        ) : null}

        {CATEGORIES.map((category) => (
          <Section key={category.title} title={category.title}>
            <View gap={8}>
              {category.types.map((type) => (
                <NotificationPreferenceRow
                  key={type}
                  type={type}
                  enabled={isTypeEnabled(preferences, type)}
                  onToggle={(next) => onToggle(type, next)}
                />
              ))}
            </View>
          </Section>
        ))}
      </ScrollView>
    </View>
  );
}
