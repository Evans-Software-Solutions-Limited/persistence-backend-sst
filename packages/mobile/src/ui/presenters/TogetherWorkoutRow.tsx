import { Text, View } from "@tamagui/core";
import {
  TogetherAthleteAvatar,
  TOGETHER_PARTNER_TONES,
  type TogetherAvatarTone,
} from "./TogetherAthleteAvatar";
import { TogetherPill } from "./TogetherPill";
import { IconSettings, iconDefaults } from "@/ui/components/icons";

/** Me is primary; partners take info, success and gold in roster order. */
export function togetherMemberTone(
  members: readonly { userId: string }[],
  accountId: string,
  userId: string,
): TogetherAvatarTone {
  if (userId === accountId) return "primary";
  const seat = members
    .filter((m) => m.userId !== accountId)
    .findIndex((m) => m.userId === userId);
  return TOGETHER_PARTNER_TONES[
    Math.max(0, seat) % TOGETHER_PARTNER_TONES.length
  ]!;
}

/**
 * The slim Together strip above the active workout (canvas rows 1b, 2, 3):
 * avatars · status · Invite (host) · End or Leave · settings cog. The
 * avatars are the tabs between your workout and each partner's (row 2).
 */
export function TogetherWorkoutRow(p: {
  members: readonly { userId: string; name: string }[];
  /**
   * The full roster each partner's colour is worked out from, when `members`
   * shows only who is still training; without it a partner who finishes
   * shifts everyone after them to a new colour mid-workout (#522).
   */
  toneMembers?: readonly { userId: string }[];
  selectedId: string;
  accountId?: string;
  status: string;
  /** Tints the status line and dot; "live" is success, "warn" is ember. */
  tone?: "live" | "warn" | "muted";
  onSelect(id: string): void;
  onSettings(): void;
  onInvite?(): void;
  onEnd(): void;
  endLabel?: string;
}) {
  const me = p.accountId ?? p.selectedId;
  const statusColor =
    p.tone === "live" ? "$success" : p.tone === "warn" ? "$ember" : "$text2";
  return (
    <View paddingHorizontal={16} testID="together-workout-row">
      <View
        minHeight={44}
        flexDirection="row"
        alignItems="center"
        gap={8}
        paddingVertical={8}
        paddingHorizontal={10}
        borderRadius={14}
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface"
      >
        <View
          flexDirection="row"
          gap={6}
          accessibilityRole="tablist"
          accessibilityLabel="Whose workout"
        >
          {p.members.map((m) => {
            const mine = m.userId === me;
            return (
              <TogetherAthleteAvatar
                key={m.userId}
                name={m.name}
                tone={togetherMemberTone(
                  p.toneMembers ?? p.members,
                  me,
                  m.userId,
                )}
                selected={m.userId === p.selectedId}
                accessibilityRole="tab"
                accessibilityLabel={
                  mine ? "Show my workout" : `Show ${m.name}’s workout`
                }
                onPress={() => p.onSelect(m.userId)}
              />
            );
          })}
        </View>
        <View flex={1} flexDirection="row" alignItems="center" gap={6}>
          {p.tone === "live" && (
            <View
              width={6}
              height={6}
              borderRadius={99}
              backgroundColor="$success"
            />
          )}
          <Text
            flex={1}
            color={statusColor}
            fontFamily="$body"
            fontSize={12}
            lineHeight={16}
            numberOfLines={2}
          >
            {p.status}
          </Text>
        </View>
        {p.onInvite && <TogetherPill onPress={p.onInvite}>Invite</TogetherPill>}
        <TogetherPill onPress={p.onEnd}>{p.endLabel ?? "End"}</TogetherPill>
        <TogetherPill
          onPress={p.onSettings}
          accessibilityLabel="Together settings"
          icon={<IconSettings {...iconDefaults({ size: 16 })} />}
        />
      </View>
    </View>
  );
}
