import { Text, View } from "@tamagui/core";

/**
 * <Stat> — big number + label combo for dashboards.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:159-175.
 * Implements 01-design-system/design.md § Foundation primitives #8 +
 * STORY-002 AC 2.3 (mono + tabular figures always).
 *
 * The `value` ALWAYS renders in $mono with tabular figures so numbers don't
 * bounce on update; Geist Mono's default glyph is a slashed zero.
 */

export type StatTone = "text" | "primary" | "gold" | "trainer" | "ember";
export type StatSize = "md" | "lg" | "xl";
export type StatAlign = "left" | "center";

export type StatProps = {
  value: string | number;
  unit?: string;
  label?: string;
  /** Signed percent: > 0 → ▲ $success, < 0 → ▼ $error. */
  trend?: number;
  tone?: StatTone;
  /** md 20 / lg 28 (default) / xl 40. */
  size?: StatSize;
  align?: StatAlign;
  sub?: string;
  testID?: string;
  accessibilityLabel?: string;
};

const VALUE_FONT_SIZE: Record<StatSize, number> = { md: 20, lg: 28, xl: 40 };
const VALUE_LINE_HEIGHT: Record<StatSize, number> = { md: 24, lg: 32, xl: 44 };
const TONE_COLOR: Record<StatTone, string> = {
  text: "$text",
  primary: "$primary",
  gold: "$gold",
  trainer: "$accentTrainer",
  ember: "$ember",
};

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export function Stat({
  value,
  unit,
  label,
  trend,
  tone = "text",
  size = "lg",
  align = "left",
  sub,
  testID,
  accessibilityLabel,
}: StatProps) {
  const valueColor = TONE_COLOR[tone];
  const alignItems = align === "center" ? "center" : "flex-start";
  const hasTrend = typeof trend === "number" && trend !== 0;
  const trendUp = (trend ?? 0) > 0;

  return (
    <View
      testID={testID}
      flexDirection="column"
      gap={4}
      alignItems={alignItems}
      accessibilityLabel={accessibilityLabel}
    >
      {label ? (
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.7}
          textTransform="uppercase"
          color="$text3"
        >
          {label}
        </Text>
      ) : null}

      <View flexDirection="row" alignItems="baseline" gap={4}>
        <Text
          testID={testID ? `${testID}-value` : undefined}
          fontFamily="$mono"
          fontWeight="600"
          fontSize={VALUE_FONT_SIZE[size]}
          lineHeight={VALUE_LINE_HEIGHT[size]}
          color={valueColor}
          fontVariant={TABULAR}
        >
          {value}
        </Text>

        {unit ? (
          <Text
            fontFamily="$mono"
            fontWeight="500"
            fontSize={13}
            color="$text3"
            fontVariant={TABULAR}
          >
            {unit}
          </Text>
        ) : null}

        {hasTrend ? (
          <Text
            testID={testID ? `${testID}-trend` : undefined}
            fontFamily="$mono"
            fontWeight="600"
            fontSize={11}
            color={trendUp ? "$success" : "$error"}
            fontVariant={TABULAR}
          >
            {`${trendUp ? "▲" : "▼"} ${Math.abs(trend as number)}%`}
          </Text>
        ) : null}
      </View>

      {sub ? (
        <Text fontFamily="$body" fontSize={12} color="$text3">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}
