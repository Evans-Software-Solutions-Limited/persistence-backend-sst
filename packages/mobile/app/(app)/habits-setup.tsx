import { HabitSetupContainer } from "@/ui/containers/HabitSetupContainer";

/**
 * `/habits-setup` — the athlete habit-setup screen (18-habit-setup, Phase
 * 18.7). Reached from the Home habits-grid empty-state CTA + the "Manage
 * habits" affordance (STORY-007). Thin wrapper — the container owns the logic,
 * mirroring `app/(app)/fuel/targets.tsx`.
 */
export default function HabitSetupScreen() {
  return <HabitSetupContainer />;
}
