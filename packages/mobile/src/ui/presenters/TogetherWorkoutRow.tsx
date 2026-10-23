import { Text, View } from "@tamagui/core";
import {
  TogetherAthleteAvatar,
  TOGETHER_PARTNER_TONES,
} from "./TogetherAthleteAvatar";
import { TogetherPill } from "./TogetherPill";
import { IconSettings, iconDefaults } from "@/ui/components/icons";

/**
 * The slim Together strip above the active workout (canvas rows 1b, 2, 3):
 * avatars · status · Invite (host) · End or Leave · settings cog.
 */
export function TogetherWorkoutRow(p: {
  members: readonly { userId: string; name: string }[];
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
  let seat = 0;
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
            const tone = mine
              ? "primary"
              : TOGETHER_PARTNER_TONES[seat++ % TOGETHER_PARTNER_TONES.length];
            return (
              <TogetherAthleteAvatar
                key={m.userId}
                name={m.name}
                tone={tone}
                selected={m.userId === p.selectedId}
                accessibilityRole="tab"
                accessibilityLabel={mine ? "My workout" : `${m.name}’s workout`}
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
