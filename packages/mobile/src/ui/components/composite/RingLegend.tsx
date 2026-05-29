import { Text, View } from "@tamagui/core";

/**
 * <RingLegend> — labelled colour dot + value + percent + optional sub.
 * Used in the TodayHero legend column beside the MultiRing.
 * Source: home.jsx:122.
 * Implements 01-design-system/design.md § Composite primitives #4.
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export type RingLegendProps = {
  /** Concrete dot colour, matching the ring it labels. */
  color: string;
  label: string;
  value: string;
  sub?: string;
  /** 0..1 — rendered as a percent next to the value. */
  pct: number;
  testID?: string;
};

export function RingLegend({
  color,
  label,
  value,
  sub,
  pct,
  testID,
}: RingLegendProps) {
  const percent = `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%`;

  return (
    <View
      testID={testID}
      flexDirection="row"
      alignItems="center"
      gap={8}
      accessibilityLabel={`${label} ${value} ${percent}`}
    >
      <View width={8} height={8} borderRadius={9999} backgroundColor={color} />
      <View flex={1}>
        <Text
          fontFamily="$display"
          fontSize={11}
          fontWeight="600"
          letterSpacing={0.5}
          textTransform="uppercase"
          color="$text3"
          numberOfLines={1}
        >
          {label}
        </Text>
        <View flexDirection="row" alignItems="baseline" gap={4}>
          <Text
            fontFamily="$mono"
            fontWeight="600"
            fontSize={14}
            color="$text"
            fontVariant={TABULAR}
          >
            {value}
          </Text>
          <Text
            fontFamily="$mono"
            fontSize={11}
            color="$text3"
            fontVariant={TABULAR}
          >
            {percent}
          </Text>
        </View>
        {sub ? (
          <Text fontFamily="$body" fontSize={11} color="$text3">
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
