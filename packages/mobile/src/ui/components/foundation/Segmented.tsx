import { Text, View } from "@tamagui/core";
import { Pressable, ScrollView, useWindowDimensions } from "react-native";

import { toneTokens } from "./tones";

/**
 * <Segmented> — top-level switcher used inside hubs (Train: Workouts |
 * Exercises). Ports ~/Downloads/handoff/design-source/tab-bar.jsx:88-115.
 * Implements 01-design-system/design.md § Foundation primitives #9 +
 * STORY-003 AC 3.7 + locked decision #9 (2-5 options).
 *
 * Equal-width inline segments, $surface2 track, active segment $surface4 fill
 * + accent-dim shadow ring. With ≥4 options on a narrow (<360pt) viewport the
 * control auto-scrolls horizontally rather than truncating labels.
 */

export type SegmentedOption = string | { value: string; label: string };
export type SegmentedAccent = "primary" | "gold" | "trainer";
export type SegmentedSize = "sm" | "md";

export type SegmentedProps = {
  /** 2-5 options. */
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  accent?: SegmentedAccent;
  size?: SegmentedSize;
  testID?: string;
};

const SIZE_SPEC: Record<
  SegmentedSize,
  { height: number; padding: number; fontSize: number }
> = {
  sm: { height: 32, padding: 3, fontSize: 12 },
  md: { height: 38, padding: 4, fontSize: 13 },
};

const NARROW_VIEWPORT = 360;

function optionValue(o: SegmentedOption): string {
  return typeof o === "string" ? o : o.value;
}
function optionLabel(o: SegmentedOption): string {
  return typeof o === "string" ? o : o.label;
}

export function Segmented({
  options,
  value,
  onChange,
  accent = "primary",
  size = "md",
  testID,
}: SegmentedProps) {
  const spec = SIZE_SPEC[size];
  const accentDim = toneTokens(accent).dim;
  const { width } = useWindowDimensions();
  // ≥4 options on a narrow viewport scroll horizontally (AC 3.7).
  const scrollable = options.length >= 4 && width < NARROW_VIEWPORT;

  const segments = options.map((o) => {
    const v = optionValue(o);
    const label = optionLabel(o);
    const isActive = value === v;
    return (
      <Pressable
        key={v}
        testID={testID ? `${testID}-option-${v}` : undefined}
        onPress={() => onChange(v)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={label}
        style={{
          flex: scrollable ? undefined : 1,
          minHeight: spec.height - spec.padding * 2,
        }}
      >
        <View
          height={spec.height - spec.padding * 2}
          paddingHorizontal={14}
          borderRadius={9}
          alignItems="center"
          justifyContent="center"
          backgroundColor={isActive ? "$surface4" : "transparent"}
          borderColor={isActive ? accentDim : "transparent"}
          borderWidth={1}
        >
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={spec.fontSize}
            numberOfLines={1}
            color={isActive ? "$text" : "$text3"}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    );
  });

  const track = (
    <View
      testID={testID}
      accessibilityRole="tablist"
      flexDirection="row"
      alignItems="center"
      gap={2}
      padding={spec.padding}
      borderRadius={12}
      backgroundColor="$surface2"
      borderColor="$border"
      borderWidth={1}
    >
      {segments}
    </View>
  );

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID={testID ? `${testID}-scroll` : undefined}
      >
        {track}
      </ScrollView>
    );
  }

  return track;
}
