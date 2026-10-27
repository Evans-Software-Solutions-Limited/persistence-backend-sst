import Body from "react-native-body-highlighter";
import { View } from "@tamagui/core";
import type { MuscleShare } from "@/domain/services/workoutSummary";
import { color } from "@/ui/theme/tokens";
import { tint } from "@/ui/theme/tint";

/** `n3b_shade` §3: level 1–4 is primary at 25 / 50 / 75 / 100 %. */
export const MUSCLE_SHADES = [
  tint(color.$primary, 0.25),
  tint(color.$primary, 0.5),
  tint(color.$primary, 0.75),
  color.$primary,
] as const;

const ALL_PARTS = [
  "abs",
  "adductors",
  "ankles",
  "biceps",
  "calves",
  "chest",
  "deltoids",
  "feet",
  "forearm",
  "gluteal",
  "hamstring",
  "hands",
  "head",
  "knees",
  "lower-back",
  "neck",
  "obliques",
  "quadriceps",
  "tibialis",
  "trapezius",
  "triceps",
  "upper-back",
] as const;

/**
 * Front and back side by side (canvas row 3c, phone 7), shaded per
 * `muscleShare`. One accessibility label covers both figures.
 */
export function MuscleMap(p: {
  muscles: MuscleShare;
  /** Figure height; the width is half of it. */
  height?: number;
}) {
  const scale = (p.height ?? 280) / 400;
  // The library's own parts carry a grey; every region not worked is set to
  // the canvas idle fill, the head a step lighter.
  const worked = new Set<string>(p.muscles.regions.map((r) => r.slug));
  const data = [
    ...p.muscles.regions,
    ...ALL_PARTS.filter((slug) => !worked.has(slug)).map((slug) => ({
      slug,
      styles: {
        fill: slug === "head" ? color.$surface4 : color.$bodyMapIdle,
      },
    })),
  ];
  const figure = (side: "front" | "back") => (
    <Body
      data={data}
      side={side}
      scale={scale}
      colors={MUSCLE_SHADES}
      border="none"
      hiddenParts={["hair"]}
      defaultFill={color.$bodyMapIdle}
      defaultStroke={color.$bg}
      defaultStrokeWidth={3}
    />
  );
  return (
    <View
      flexDirection="row"
      justifyContent="center"
      gap={22}
      accessible
      accessibilityRole="image"
      accessibilityLabel={p.muscles.accessibilityLabel}
      testID="muscle-map"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {figure("front")}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {figure("back")}
      </View>
    </View>
  );
}
