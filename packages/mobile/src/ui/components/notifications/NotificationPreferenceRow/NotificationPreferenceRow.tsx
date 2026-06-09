import { Text, View } from "@tamagui/core";
import { Switch } from "react-native";

import type { NotificationType } from "@/domain/models/notification";
import { notificationTypeLabel } from "@/domain/models/notification";
import { notificationVisual } from "@/ui/components/notifications/NotificationRow";
import { color } from "@/ui/theme/tokens";

/**
 * <NotificationPreferenceRow> — a per-type opt-in toggle row.
 *
 * DrawerRow-style layout (tone-tinted 36×36 icon tile + label) with a
 * trailing `Switch`. Deliberately omits DrawerRow's built-in chevron — a
 * chevron implies navigation, which is wrong for a toggle — and lives in
 * the notifications lane rather than editing the shared DrawerRow
 * primitive (avoids cross-stream collision). Reconciles design.md AC 3.4
 * ("DrawerRow with switch") to the toggle semantics. Revised 2026-06-07.
 *
 * Spec: specs/09-notifications-social/design.md § NotificationPreferencesPresenter
 *       requirements.md STORY-003 AC 3.4
 */

export type NotificationPreferenceRowProps = {
  type: NotificationType;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  /** Disable the switch (e.g. while OS permission is off). */
  disabled?: boolean;
};

export function NotificationPreferenceRow({
  type,
  enabled,
  onToggle,
  disabled = false,
}: NotificationPreferenceRowProps) {
  const { Icon, tone } = notificationVisual(type);
  // The 9 known types only ever map to trainer / primary / gold / success.
  // `trainer` is special-cased because its token family is `$accentTrainer*`
  // (not `$trainer*`); every other tone follows the `$<tone>Dim` / `$<tone>`
  // convention.
  const tileBg = tone === "trainer" ? "$accentTrainerDim" : `$${tone}Dim`;
  const iconColor =
    tone === "trainer"
      ? color.$accentTrainer
      : (color as Record<string, string>)[`$${tone}`];
  const label = notificationTypeLabel(type);

  return (
    <View
      testID={`pref-row-${type}`}
      flexDirection="row"
      alignItems="center"
      gap={12}
      backgroundColor="$surface2"
      borderColor="$border"
      borderWidth={1}
      borderRadius={12}
      paddingVertical={10}
      paddingHorizontal={12}
      minHeight={44}
    >
      <View
        width={36}
        height={36}
        borderRadius={10}
        backgroundColor={tileBg}
        alignItems="center"
        justifyContent="center"
      >
        <Icon size={18} color={iconColor} />
      </View>

      <Text
        flex={1}
        fontFamily="$display"
        fontWeight="600"
        fontSize={16}
        letterSpacing={-0.2}
        color="$text"
        numberOfLines={1}
      >
        {label}
      </Text>

      <Switch
        testID={`pref-switch-${type}`}
        value={enabled}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: color.$surface3, true: color.$primary }}
        thumbColor={color.$text}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled }}
      />
    </View>
  );
}
