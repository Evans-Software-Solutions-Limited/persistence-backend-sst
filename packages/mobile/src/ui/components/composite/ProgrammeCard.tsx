import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneTokens, type Tone } from "@/ui/components/foundation/tones";
import { IconChevronR } from "@/ui/components/icons";
import { CoachAttribution } from "./CoachAttribution";

/**
 * <ProgrammeCard> — the "ACTIVE PROGRAMME" block shared by the athlete Home
 * "Your programme" card and (later) the coach Client Detail. Ports the
 * prototype `ProgrammeCard` (design-source/screens/client-detail.jsx:564-591)
 * 1:1: a left-accent Card with the eyebrow + name + optional chevron, a
 * "Week N / M · K weeks remaining" line, and a segmented week-progress bar.
 *
 * Indefinite programmes (`totalWeeks === null`) render "Week N · Ongoing" with
 * NO progress bar or denominator (specs/19-programs STORY-005 AC 5.1 / D1).
 *
 * Pure presentational. `onPress` makes the whole card a Pressable AND surfaces
 * the chevron affordance; omit it for a static informational card (the athlete
 * has no programme-detail destination in v1).
 */

export type ProgrammeCardProps = {
  programName: string;
  /** 1-based calendar week the client is currently in. */
  week: number;
  /** null = indefinite programme ("Ongoing"). */
  totalWeeks: number | null;
  /** Left-border + fill accent. Athlete card = "primary"; coach cycles. */
  accent?: Tone;
  /**
   * The assigning coach's name — when set, renders a <CoachAttribution> line
   * ("Assigned by Coach X", Phase 11). Omit for self-owned / coach-side cards.
   */
  coachName?: string | null;
  onPress?: () => void;
  testID?: string;
};

export function ProgrammeCard({
  programName,
  week,
  totalWeeks,
  accent = "primary",
  coachName,
  onPress,
  testID,
}: ProgrammeCardProps) {
  const accentBase = toneTokens(accent).base;
  const isIndefinite = totalWeeks === null;
  const remaining = isIndefinite ? 0 : Math.max(totalWeeks - week, 0);

  return (
    <Card
      pad={16}
      radius={16}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={`Active programme: ${programName}`}
      style={{ borderLeftWidth: 3, borderLeftColor: accentBase }}
    >
      {/* Header: eyebrow + name, optional chevron. */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={12}
      >
        <View flex={1} paddingRight={12}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={4}
          >
            Active programme
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={17}
            color="$text"
            numberOfLines={1}
          >
            {programName}
          </Text>
        </View>
        {onPress ? <IconChevronR size={16} color="#8A8A98" /> : null}
      </View>

      {/* Week line. */}
      <View
        flexDirection="row"
        alignItems="center"
        gap={8}
        marginBottom={isIndefinite ? 0 : 6}
      >
        <Text fontFamily="$mono" fontSize={12} color="$text2">
          {isIndefinite
            ? `Week ${week} · Ongoing`
            : `Week ${week} / ${totalWeeks}`}
        </Text>
        {!isIndefinite && remaining > 0 ? (
          <Text fontFamily="$mono" fontSize={12} color="$text3">
            {`· ${remaining} week${remaining === 1 ? "" : "s"} remaining`}
          </Text>
        ) : null}
      </View>

      {/* Segmented week-progress bar — finite programmes only. */}
      {!isIndefinite ? (
        <View flexDirection="row" gap={3} testID={`${testID}-bar`}>
          {Array.from({ length: totalWeeks }).map((_, i) => {
            const isCurrent = i === week - 1;
            const isDone = i < week;
            return (
              <View
                key={i}
                flex={1}
                height={6}
                borderRadius={2}
                backgroundColor={isDone ? accentBase : "$surface3"}
                opacity={isCurrent ? 1 : isDone ? 0.5 : 1}
              />
            );
          })}
        </View>
      ) : null}

      {/* Coach attribution — "Assigned by Coach X" (Phase 11). */}
      {coachName ? (
        <View
          marginTop={isIndefinite ? 10 : 12}
          testID={testID ? `${testID}-coach` : undefined}
        >
          <CoachAttribution name={coachName} label="Assigned by Coach" />
        </View>
      ) : null}
    </Card>
  );
}
