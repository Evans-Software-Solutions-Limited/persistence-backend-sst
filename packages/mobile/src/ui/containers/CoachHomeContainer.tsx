import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * <CoachHomeContainer> — the coach-mode Home tab.
 *
 * Spec: specs/14-navigation/design.md § Route migration table (index.tsx)
 *       specs/14-navigation/tasks.md T-14.3.7
 *
 * STUB: 14-navigation reserves the coach-mode Home slot only. The real
 * Coach Home content is owned by `10-trainer-features` (M8), which replaces
 * this placeholder when its frontend ships. The athlete Home
 * (`HomeContainer`) is unchanged and owned by `06-progress-goals`.
 */
export function CoachHomeContainer() {
  return (
    <ComingSoon
      icon="people-outline"
      title="Coach Home"
      description="Your coaching dashboard arrives in milestone M8 (10-trainer-features)."
      safeAreaTop
      testID="coach-home"
    />
  );
}
