import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable } from "react-native";

import { Pill } from "../foundation/Pill";
import { NEUTRAL_HEX } from "../foundation/tones";
import { IconPlay, IconTimer } from "../icons";
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
  /** Promoted first-of-list variant: $primaryDim border emphasis. (The cyan
   * gradient tint renders on every tile — design.md 2026-05-31 override.) */
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
      backgroundColor="$surface2"
      minHeight={44}
    >
      {/* Faint cyan tint over the solid surface-2 base. The prototype's
          `linear-gradient(135deg, rgba(34,211,238,0.08), surface-2 60%)` is an
          8% cyan wash fading into the card colour — translated as cyan →
          TRANSPARENT (same hue fading to nothing) so the blend never passes
          through a muddy mid-band the way a direct cyan→surface-2 lerp does.
          Product override (design.md 2026-05-31): the gradient renders on
          EVERY tile, not just the promoted one — `primary` now only drives the
          border emphasis. The gradient carries its OWN borderRadius (rather
          than the card using overflow:hidden to clip it) so the parent doesn't
          clip the play button's glow (iOS clips child shadows under
          overflow:hidden). */}
      <LinearGradient
        colors={["rgba(34,211,238,0.08)", "rgba(34,211,238,0)"]}
        locations={[0, 0.6]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 16,
        }}
      />

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
                // Prototype: `box-shadow: 0 0 16px var(--primary-glow)`.
                // iOS renders shadows far denser than a CSS blur (the blur
                // disperses colour; iOS fills the silhouette then blurs), so a
                // literal radius-16 @ 0.22 reads as a harsh neon ring on a 34pt
                // disc. Translated to a softer equivalent: solid cyan, low
                // opacity, ~half the radius — a gentle halo, not a beacon.
                shadowColor: "#22D3EE",
                shadowOpacity: 0.2,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 0 },
              }}
            >
              <IconPlay
                size={14}
                color="#0A0B12"
                fill="#0A0B12"
                strokeWidth={1.75}
              />
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
            {/* Timer pill — icon + label as flex siblings (the Pill primitive
                wraps children in a single <Text>, which can't host an SVG
                glyph), so the timer chip is built inline to match the
                prototype's `<IconTimer/> {mins}M` row. */}
            <View
              flexDirection="row"
              alignItems="center"
              gap={4}
              alignSelf="flex-start"
              borderRadius={9999}
              paddingVertical={2}
              paddingHorizontal={6}
              backgroundColor="$surface3"
              borderColor="$border2"
              borderWidth={1}
            >
              <IconTimer size={11} strokeWidth={2} color={NEUTRAL_HEX.text2} />
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={9.5}
                letterSpacing={0.95}
                textTransform="uppercase"
                color="$text2"
              >
                {`${mins}M`}
              </Text>
            </View>
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
