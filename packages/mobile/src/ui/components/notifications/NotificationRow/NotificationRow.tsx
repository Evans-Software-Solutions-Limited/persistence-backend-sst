import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import type { ComponentType } from "react";

import type {
  Notification,
  WireNotificationType,
} from "@/domain/models/notification";
import { isUnread, notificationTypeLabel } from "@/domain/models/notification";
import { relativeTime } from "@/application/notifications/grouping";
import {
  IconApple,
  IconBell,
  IconChart,
  IconChevronR,
  IconCheck,
  IconClock,
  IconDumbbell,
  IconMessage,
  IconTarget,
  IconUser,
  IconUsers,
  iconDefaults,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * <NotificationRowPresenter> — spec-local composite for one notification.
 * 36×36 tone-tinted icon tile + title + 2-line body + compact relative
 * time + chevron. Unread rows get a `$primaryDim` background.
 *
 * Forward-compatible: an unknown / future notification `type` falls back
 * to a neutral bell visual (never crashes the list).
 *
 * Spec: specs/09-notifications-social/design.md § NotificationRowPresenter
 *       requirements.md STORY-002 AC 2.4, 2.5
 */

type NotifTone =
  | "primary"
  | "gold"
  | "trainer"
  | "ember"
  | "success"
  | "neutral";

type Visual = {
  Icon: ComponentType<{ size?: number; color?: string }>;
  tone: NotifTone;
};

const TONE_VISUAL: Record<NotifTone, { tileBg: string; iconColor: string }> = {
  primary: { tileBg: "$primaryDim", iconColor: color.$primary },
  gold: { tileBg: "$goldDim", iconColor: color.$gold },
  trainer: { tileBg: "$accentTrainerDim", iconColor: color.$accentTrainer },
  ember: { tileBg: "$emberDim", iconColor: color.$ember },
  success: { tileBg: "$successDim", iconColor: color.$success },
  neutral: { tileBg: "$surface3", iconColor: color.$text2 },
};

/**
 * Map a notification type to its row icon + tone. Data-driven: registering
 * a new type later is a one-line addition here (plus the enum + category).
 * The `default` arm is the forward-compatible fallback for any unknown /
 * future type.
 */
// NOTE: keep every registered `NotificationType` mapped to a case below; the
// shared <NotificationPreferenceRow> relies on the returned `tone` being one of
// trainer / primary / gold / success for its tile-colour lookup.
export function notificationVisual(type: WireNotificationType): Visual {
  switch (type) {
    case "workout_assigned":
      return { Icon: IconDumbbell, tone: "trainer" };
    case "friend_request":
      return { Icon: IconUsers, tone: "primary" };
    case "pt_request":
      return { Icon: IconUser, tone: "trainer" };
    case "pt_accepted":
      return { Icon: IconCheck, tone: "trainer" };
    case "physio_request":
      return { Icon: IconUser, tone: "primary" };
    case "physio_accepted":
      return { Icon: IconCheck, tone: "primary" };
    case "workout_reminder":
      return { Icon: IconClock, tone: "gold" };
    case "goal_milestone":
      return { Icon: IconTarget, tone: "success" };
    case "trainer_feedback":
      return { Icon: IconMessage, tone: "trainer" };
    // M8 Coach Mode Phase 3 — coach on-behalf / assignment events. All use the
    // `trainer` tone (coach-driven), matching pt_* and trainer_feedback.
    case "goal_assigned_by_trainer":
      return { Icon: IconTarget, tone: "trainer" };
    case "workout_logged_on_behalf":
      return { Icon: IconDumbbell, tone: "trainer" };
    case "measurement_logged_on_behalf":
      return { Icon: IconChart, tone: "trainer" };
    case "nutrition_target_set_by_trainer":
      return { Icon: IconApple, tone: "trainer" };
    default:
      return { Icon: IconBell, tone: "neutral" };
  }
}

export type NotificationRowProps = {
  notification: Notification;
  onPress: () => void;
  /** Injected clock for deterministic relative-time rendering in tests. */
  now?: number;
};

export function NotificationRowPresenter({
  notification,
  onPress,
  now,
}: NotificationRowProps) {
  const unread = isUnread(notification);
  const { Icon, tone } = notificationVisual(notification.type);
  const visual = TONE_VISUAL[tone];
  const time = relativeTime(notification.createdAt, now);
  const title = notification.title || notificationTypeLabel(notification.type);

  return (
    <Pressable
      testID={`notification-row-${notification.id}`}
      onPress={onPress}
      accessibilityRole="button"
      // Fold unread into the label rather than `accessibilityState.selected`
      // (which screen readers announce as multi-select, the wrong semantic).
      accessibilityLabel={unread ? `Unread. ${title}` : title}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        paddingHorizontal={16}
        backgroundColor={unread ? "$primaryDim" : "transparent"}
      >
        <View
          width={36}
          height={36}
          borderRadius={10}
          backgroundColor={visual.tileBg}
          alignItems="center"
          justifyContent="center"
        >
          <Icon size={18} color={visual.iconColor} />
        </View>

        <View flex={1} gap={2}>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            gap={8}
          >
            <Text
              flex={1}
              fontFamily="$display"
              fontWeight={unread ? "700" : "600"}
              fontSize={15}
              letterSpacing={-0.2}
              color="$text"
              numberOfLines={1}
            >
              {title}
            </Text>
            {time ? (
              <Text fontFamily="$mono" fontSize={11} color="$text3">
                {time}
              </Text>
            ) : null}
          </View>
          {notification.body ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text2"
              numberOfLines={2}
            >
              {notification.body}
            </Text>
          ) : null}
        </View>

        <IconChevronR {...iconDefaults({ size: 14 })} color={color.$text3} />
      </View>
    </Pressable>
  );
}
