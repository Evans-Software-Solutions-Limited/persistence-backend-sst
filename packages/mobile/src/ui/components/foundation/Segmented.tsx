import { Text, View } from "@tamagui/core";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, type LayoutChangeEvent } from "react-native";

import { toneTokens } from "./tones";

/**
 * <Segmented> — top-level switcher used inside hubs (Train: Workouts |
 * Exercises). Ports ~/Downloads/handoff/design-source/tab-bar.jsx:88-115.
 * Implements 01-design-system/design.md § Foundation primitives #9 +
 * STORY-003 AC 3.7 + locked decision #9 (2-5 options).
 *
 * Content-width inline segments (each hugs its label, per the prototype's
 * `inline-flex` track — the control does NOT stretch full-width), $surface2
 * track left-aligned, active segment $surface4 fill + accent-dim shadow ring.
 * With ≥4 options the control auto-scrolls horizontally rather than truncating
 * labels.
 *
 * ⚠ **The scroll is NOT gated on viewport width, deliberately** (changed
 * 2026-08-02, when the Train hub gained a fourth `Gyms` segment). The old gate was
 * `width < 360`, which left every phone between 360pt and the track's actual
 * content width clipping instead of scrolling: "Training Workouts Exercises Gyms"
 * measures ~320pt of content plus padding, so a 375pt iPhone SE was inside the
 * risk band with no way to reach the last segment.
 *
 * Making it unconditional costs nothing: a horizontal `ScrollView` whose content
 * is narrower than its viewport simply does not scroll, and the track keeps
 * `alignSelf: flex-start`, so a fitting control looks identical. Guessing a
 * threshold against text whose width depends on the font, the locale and the
 * user's Dynamic Type setting is the part that cannot be got right.
 *
 * ⚠ **The Train hub is NOT the only 4-option consumer**, so this change is not
 * confined to it. `MealPickerPresenter` feeds the four `MEAL_SLOTS` straight in
 * and renders inside three bottom sheets (`QuickAddSheetPresenter`,
 * `ScanBarcodeSheetPresenter`, `AiDraftConfirmPresenter`) — those previously took
 * the scrolling path only below 360pt and now take it everywhere. Device-checked
 * on the Fuel quick-add sheet at 402pt: unchanged. Re-check them if this
 * component's layout is touched again.
 *
 * ⚠ **The active option is scrolled into view on mount and on change.** Without
 * it the track always started at offset 0, so a persisted last-position segment
 * (the Train hub writes `persistence.train.segment` to disk) could cold-launch
 * with its body rendered and its pill off-screen — a switcher showing nothing
 * selected. That is reachable exactly where the width gate used to be wrong:
 * narrow devices, large Dynamic Type, longer locales.
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
  // ≥4 options scroll horizontally rather than truncating (AC 3.7). No width
  // gate — see the docblock: a ScrollView that does not need to scroll is inert,
  // and the threshold it replaces was a guess about text metrics.
  const scrollable = options.length >= 4;

  /**
   * Scroll the active option into view. `onLayout` on each segment is the only
   * source of its x-offset — the labels are text, so nothing here knows a
   * segment's width until it has been measured.
   */
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetsRef = useRef<Map<string, number>>(new Map());

  const onSegmentLayout = useCallback((v: string, e: LayoutChangeEvent) => {
    offsetsRef.current.set(v, e.nativeEvent.layout.x);
  }, []);

  useEffect(() => {
    if (!scrollable) return;
    const x = offsetsRef.current.get(value);
    if (x === undefined) return;
    // A little lead-in so the active pill is not flush against the edge, and
    // never negative — `scrollTo` clamps, but a negative offset reads as a bug.
    scrollRef.current?.scrollTo({ x: Math.max(0, x - 12), animated: true });
  }, [scrollable, value, options.length]);

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
        onLayout={(e) => onSegmentLayout(v, e)}
        style={{
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
      alignSelf="flex-start"
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
        ref={scrollRef}
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
