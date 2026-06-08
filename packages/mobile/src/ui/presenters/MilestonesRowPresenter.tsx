import type { ReactNode } from "react";
import { Text, View } from "@tamagui/core";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";

/**
 * <MilestonesRowPresenter> — You/Progress badges row (06-progress-goals,
 * STORY-003 AC 3.3; progress.jsx:112–139). 5 tier cells, tone-gradient + glow
 * dot when earned, dimmed when not.
 */

export type MilestoneTier = {
  label: string;
  earned: boolean;
  tone: Tone;
  icon: ReactNode;
};

export type MilestonesRowProps = {
  tiers: MilestoneTier[];
  testID?: string;
};

export function MilestonesRowPresenter({
  tiers,
  testID = "milestones-row",
}: MilestonesRowProps) {
  return (
    <View flexDirection="row" gap={8} testID={testID}>
      {tiers.map((t, i) => {
        const hex = toneHex(t.tone);
        return (
          <View
            key={`${t.label}-${i}`}
            flex={1}
            paddingVertical={16}
            borderRadius={14}
            borderWidth={1}
            alignItems="center"
            justifyContent="center"
            gap={6}
            opacity={t.earned ? 1 : 0.45}
            backgroundColor={t.earned ? hex.dim : "$surface"}
            borderColor={t.earned ? hex.dim : "$border"}
          >
            <View opacity={t.earned ? 1 : 0.8}>{t.icon}</View>
            <Text
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1}
              color={t.earned ? (`$${t.tone}` as never) : "$text3"}
            >
              {t.label}
            </Text>
            {t.earned && (
              <View
                position="absolute"
                top={4}
                right={4}
                width={6}
                height={6}
                borderRadius={3}
                backgroundColor={hex.base}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}
