import { Text, View } from "@tamagui/core";

import { Card } from "../foundation/Card";
import { IconMedal, iconDefaults } from "../icons";
import { Skeleton } from "../Skeleton";

/**
 * <PRCard> — gold-tinted personal-record card with medal, strikethrough
 * previous value, and a success-green delta.
 * Used by Home PRCarousel + Progress PRHistory + Session Summary.
 * Source: home.jsx:341 + progress.jsx:227.
 * Implements 01-design-system/design.md § Composite primitives #5 +
 * STORY-004 AC 4.6 (loading skeleton).
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export type PRCardProps = {
  exerciseName: string;
  /** e.g. "120 KG × 5". */
  newValue: string;
  /** Previous best, rendered struck-through. */
  previousValue?: string;
  delta?: { value: number; unit: string };
  achievedAt: Date;
  loading?: boolean;
  testID?: string;
};

function formatAchievedAt(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function PRCard({
  exerciseName,
  newValue,
  previousValue,
  delta,
  achievedAt,
  loading = false,
  testID,
}: PRCardProps) {
  if (loading) {
    return (
      <Card accent="gold" glow="gold" testID={testID}>
        <View gap={8}>
          <Skeleton
            width={120}
            height={16}
            variant="text"
            testID={testID ? `${testID}-skeleton` : undefined}
          />
          <Skeleton width={90} height={18} variant="text" />
          <Skeleton width={60} height={11} variant="text" />
        </View>
      </Card>
    );
  }

  return (
    <Card
      accent="gold"
      glow="gold"
      testID={testID}
      accessibilityLabel={`Personal record: ${exerciseName}, ${newValue}`}
    >
      <View flexDirection="row" justifyContent="space-between">
        <View flex={1} gap={4}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color="$text"
            numberOfLines={1}
          >
            {exerciseName}
          </Text>

          <Text
            fontFamily="$mono"
            fontWeight="600"
            fontSize={18}
            color="$gold"
            fontVariant={TABULAR}
          >
            {newValue}
          </Text>

          <View flexDirection="row" alignItems="center" gap={8}>
            {previousValue ? (
              <Text
                fontFamily="$mono"
                fontSize={12}
                color="$text3"
                fontVariant={TABULAR}
                textDecorationLine="line-through"
              >
                {previousValue}
              </Text>
            ) : null}
            {delta ? (
              <Text
                fontFamily="$mono"
                fontWeight="600"
                fontSize={11}
                color="$success"
                fontVariant={TABULAR}
              >
                {`▲ ${delta.value}${delta.unit}`}
              </Text>
            ) : null}
          </View>

          <Text fontFamily="$body" fontSize={11} color="$text3">
            {formatAchievedAt(achievedAt)}
          </Text>
        </View>

        <View>
          <IconMedal {...iconDefaults({ size: 18 })} color="#F5C518" />
        </View>
      </View>
    </Card>
  );
}
