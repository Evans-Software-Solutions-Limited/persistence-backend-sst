import type { ReactNode } from "react";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import {
  IconFlame,
  IconBolt,
  IconDumbbell,
  IconMedal,
  IconCrown,
} from "@/ui/components/icons";
import type { Achievement } from "@/domain/models/achievement";
import type { MilestoneTier } from "@/ui/presenters/MilestonesRowPresenter";

/**
 * Shared workout-streak → milestone-tier mapping (06-progress-goals,
 * STORY-003 AC 3.3). Originally local to <YouContainer>; extracted so the
 * go-live Achievements screen (drawer "Achievements" row) can render the
 * same 5-tier badge row without duplicating the mapping. <YouContainer>
 * re-exports `buildMilestoneTiers` from here for its existing callers/tests.
 */
const WORKOUT_TIERS: {
  threshold: number;
  label: string;
  tone: Tone;
  Icon: typeof IconFlame;
}[] = [
  { threshold: 1, label: "1w", tone: "ember", Icon: IconFlame },
  { threshold: 2, label: "2w", tone: "primary", Icon: IconBolt },
  { threshold: 4, label: "4w", tone: "gold", Icon: IconDumbbell },
  { threshold: 8, label: "2mo", tone: "trainer", Icon: IconMedal },
  { threshold: 12, label: "3mo", tone: "gold", Icon: IconCrown },
];

/** Map unlocked workout-streak achievements to the 5 milestone tier cells. */
export function buildMilestoneTiers(
  achievements: Achievement[],
): MilestoneTier[] {
  const earned = new Set(
    achievements
      .filter(
        (a) =>
          a.category === "streak" &&
          a.requirements?.streak_type === "workout_streak",
      )
      .map((a) => Number(a.requirements?.threshold)),
  );
  return WORKOUT_TIERS.map((t): MilestoneTier => {
    const isEarned = earned.has(t.threshold);
    return {
      label: t.label,
      earned: isEarned,
      tone: t.tone,
      // Icon `color` is an exempt concrete-colour position; "#8A8A98" = $text3.
      icon: (
        <t.Icon size={20} color={isEarned ? toneHex(t.tone).base : "#8A8A98"} />
      ) as ReactNode,
    };
  });
}
