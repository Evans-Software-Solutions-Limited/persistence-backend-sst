import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { memo, type ReactNode } from "react";

import { IconMedal } from "../icons";
import { Skeleton } from "../Skeleton";

/**
 * <PRCard> — gold achievement carousel tile.
 * Ports ~/Downloads/handoff/design-source/screens/home.jsx:341 (PRCarousel),
 * pinned 1:1 by docs/Persistence - Card Components (Corrected).html.
 * Implements 01-design-system/design.md § Composite primitives #5 +
 * the 2026-05-31 PRCard prototype correction + STORY-004 AC 4.6 (loading).
 *
 * A 180pt fixed-width horizontal-scroll tile: diagonal gold-dim→surface-2
 * gradient, flat gold-dim border (NO glow), a faint 70pt medal watermark, a
 * "NEW PR" pill, the lift name, a gold weight + unit + success delta on one
 * baseline, and a relative date. Display-only (the carousel row owns scroll +
 * any tap target), so it renders as a <View>, nest-safe inside a ScrollView.
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];
const CARD_WIDTH = 180;
const GOLD_HEX = "#F5C518"; // $gold — concrete for the SVG medal (no token in SVG)

export type PRCardProps = {
  /** Lift name, e.g. "Bench Press". */
  exerciseName: string;
  /** Weight value, e.g. "85" or 85. Rendered gold in $mono. */
  value: string | number;
  /** Unit, e.g. "kg". */
  unit: string;
  /** Pre-formatted signed delta, e.g. "+5". Rendered $success when present. */
  delta?: string;
  /** Pre-formatted relative date, e.g. "2 days ago". */
  date: string;
  loading?: boolean;
  testID?: string;
};

function PRCardBase({
  exerciseName,
  value,
  unit,
  delta,
  date,
  loading = false,
  testID,
}: PRCardProps) {
  const frame = (children: ReactNode) => (
    <View
      testID={testID}
      width={CARD_WIDTH}
      minWidth={CARD_WIDTH}
      borderRadius={16}
      borderWidth={1}
      borderColor="$goldDim"
      padding={14}
      position="relative"
      overflow="hidden"
      backgroundColor="$surface2"
      accessibilityLabel={
        loading ? "Loading personal record" : `Personal record: ${exerciseName}`
      }
    >
      {/* Faint gold tint over the solid surface-2 base. The prototype's
          `linear-gradient(135deg, gold-dim 0%, surface-2 80%)` is a 10% gold
          wash fading into the card colour — translated here as a gold-dim →
          TRANSPARENT overlay (same hue fading to nothing) so the interpolation
          never passes through a muddy olive mid-band the way a direct
          gold→surface-2 interpolation does (the "too yellow" bug). */}
      <LinearGradient
        colors={["rgba(245,197,24,0.10)", "rgba(245,197,24,0)"]}
        locations={[0, 0.8]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {children}
    </View>
  );

  if (loading) {
    return frame(
      <View gap={8}>
        <Skeleton
          width={64}
          height={16}
          variant="text"
          testID={testID ? `${testID}-skeleton` : undefined}
        />
        <Skeleton width={110} height={18} variant="text" />
        <Skeleton width={70} height={18} variant="text" />
        <Skeleton width={80} height={11} variant="text" />
      </View>,
    );
  }

  return frame(
    <>
      {/* Medal watermark — faint, behind content, bleeds off the top-right. */}
      <View
        position="absolute"
        top={-10}
        right={-10}
        opacity={0.18}
        pointerEvents="none"
      >
        <IconMedal size={70} color={GOLD_HEX} strokeWidth={1.75} />
      </View>

      <View
        flexDirection="row"
        alignSelf="flex-start"
        alignItems="center"
        borderRadius={9999}
        paddingVertical={2}
        paddingHorizontal={6}
        backgroundColor="$goldDim"
        borderColor="$goldDim"
        borderWidth={1}
      >
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={9.5}
          letterSpacing={0.95}
          textTransform="uppercase"
          color="$gold"
          numberOfLines={1}
        >
          NEW PR
        </Text>
      </View>

      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={18}
        letterSpacing={-0.18}
        color="$text"
        marginTop={10}
        numberOfLines={1}
      >
        {exerciseName}
      </Text>

      <View flexDirection="row" alignItems="baseline" gap={4} marginTop={4}>
        <Text
          fontFamily="$mono"
          fontWeight="500"
          fontSize={20}
          color="$gold"
          fontVariant={TABULAR}
        >
          {value}
        </Text>
        <Text
          fontFamily="$mono"
          fontSize={12}
          color="$text3"
          fontVariant={TABULAR}
        >
          {unit}
        </Text>
        {delta ? (
          <Text
            fontFamily="$mono"
            fontSize={11}
            color="$success"
            marginLeft={4}
            fontVariant={TABULAR}
          >
            {delta}
          </Text>
        ) : null}
      </View>

      <Text
        fontFamily="$body"
        fontSize={11}
        color="$text3"
        marginTop={4}
        numberOfLines={1}
      >
        {date}
      </Text>
    </>,
  );
}

/**
 * spec-12.5 (T-12.5.2): memoised for the PR carousel's recycled cards.
 */
export const PRCard = memo(PRCardBase);
