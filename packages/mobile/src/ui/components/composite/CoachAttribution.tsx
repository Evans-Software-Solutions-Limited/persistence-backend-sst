import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { IconInfo } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * <CoachAttribution> — the single, consistent "coach-originated" badge shown
 * across every athlete-side surface a coach can set/change (Phase 11,
 * cross-cuts § 1.5): nutrition targets, habits, the programme card, and each
 * "Today's training" row. Renders the assigning coach's real name
 * (`profiles.full_name`, resolved server-side) so attribution reads the same
 * everywhere rather than the old patchwork ("Set by coach" / "Set by your
 * coach" / a role-only pill).
 *
 * Two variants, same copy pattern + trainer accent:
 *  - `text` (default) — a compact trainer-tone line for dense contexts (a
 *    habit card, a training row, under the programme week line);
 *  - `banner` — a bordered info Card with an info glyph for prominent editor
 *    surfaces (the Fuel → Targets screen).
 *
 * Copy: `{label} {name}`, label defaulting to "Set by Coach". Callers override
 * `label` where the noun reads better ("Assigned by Coach" for a programme).
 * Pure presentational.
 */

export type CoachAttributionProps = {
  /** The coach's display name (server-resolved `profiles.full_name`). */
  name: string;
  /** Compact line (default) vs. a prominent info Card. */
  variant?: "text" | "banner";
  /** Leading copy before the name. Defaults to "Set by Coach". */
  label?: string;
  testID?: string;
};

export function CoachAttribution({
  name,
  variant = "text",
  label = "Set by Coach",
  testID,
}: CoachAttributionProps) {
  if (variant === "banner") {
    return (
      <Card pad={12} radius={12} accent="trainer" testID={testID}>
        <View flexDirection="row" alignItems="center" gap={8}>
          <IconInfo size={14} color={color.$accentTrainer} />
          <Text fontFamily="$body" fontSize={12.5} color="$text2" flex={1}>
            {label}{" "}
            <Text fontWeight="600" color="$text">
              {name}
            </Text>
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Text
      fontFamily="$body"
      fontSize={11}
      color="$accentTrainer"
      testID={testID}
    >
      {label} <Text fontWeight="600">{name}</Text>
    </Text>
  );
}
