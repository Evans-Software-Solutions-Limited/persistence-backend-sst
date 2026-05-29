import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable } from "react-native";

import { Pill } from "../foundation/Pill";
import { IconPlay, iconDefaults } from "../icons";
import { Skeleton } from "../Skeleton";

/**
 * <WorkoutCarouselCard> — 260pt fixed-width horizontal-scroll card with an
 * optional `primary` gradient highlight. Home WorkoutCarousel only (distinct
 * from the Train hub list-row <WorkoutCard> owned by 04-workout-management).
 * Source: home.jsx:197.
 * Implements 01-design-system/design.md § Composite primitives #8 +
 * STORY-004 AC 4.4 (binary `primary`) + 4.6 (loading skeleton).
 */

const CARD_WIDTH = 260;

export type WorkoutCarouselCardProps = {
  title: string;
  mins: number;
  sub: string;
  chips: string[];
  /** Promoted first-of-list variant: cyan gradient + primary-dim border. */
  primary?: boolean;
  onPress?: () => void;
  loading?: boolean;
  testID?: string;
};

export function workoutCarouselCardPressStyle({
  pressed,
}: {
  pressed: boolean;
}) {
  return { opacity: pressed ? 0.85 : 1, width: CARD_WIDTH };
}

export function WorkoutCarouselCard({
  title,
  mins,
  sub,
  chips,
  primary = false,
  onPress,
  loading = false,
  testID,
}: WorkoutCarouselCardProps) {
  const borderColor = primary ? "$primaryDim" : "$border";

  const inner = (
    <View
      width={CARD_WIDTH}
      borderRadius={16}
      borderWidth={1}
      borderColor={borderColor}
      padding={16}
      overflow="hidden"
      backgroundColor={primary ? "transparent" : "$surface2"}
      minHeight={44}
    >
      {primary ? (
        <LinearGradient
          colors={["rgba(34,211,238,0.08)", "#1A1D29"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}

      {loading ? (
        <View gap={10}>
          <Skeleton
            width={140}
            height={20}
            variant="text"
            testID={testID ? `${testID}-skeleton` : undefined}
          />
          <Skeleton width={200} height={36} variant="text" />
          <Skeleton width={120} height={16} variant="text" />
        </View>
      ) : (
        <>
          <View
            flexDirection="row"
            justifyContent="space-between"
            alignItems="flex-start"
            marginBottom={8}
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={20}
              letterSpacing={-0.4}
              color="$text"
              flex={1}
              numberOfLines={2}
            >
              {title}
            </Text>
            <View
              width={34}
              height={34}
              borderRadius={9999}
              backgroundColor="$primary"
              alignItems="center"
              justifyContent="center"
              style={{
                shadowColor: "rgba(34,211,238,0.22)",
                shadowOpacity: 1,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 0 },
              }}
            >
              <IconPlay {...iconDefaults({ size: 14 })} color="#0A0B12" />
            </View>
          </View>

          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text2"
            marginBottom={12}
            minHeight={36}
          >
            {sub}
          </Text>

          <View flexDirection="row" alignItems="center" gap={6} flexWrap="wrap">
            <Pill tone="neutral" size="xs">
              {`${mins}M`}
            </Pill>
            {chips.map((c) => (
              <Pill key={c} tone="neutral" size="xs">
                {c}
              </Pill>
            ))}
          </View>
        </>
      )}
    </View>
  );

  if (!onPress || loading) {
    return (
      <View
        testID={testID}
        accessibilityLabel={loading ? "Loading workout" : title}
      >
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${mins} minutes`}
      style={workoutCarouselCardPressStyle}
    >
      {inner}
    </Pressable>
  );
}
