import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * <YouContainer> — the "You" tab (athlete Progress + identity surface).
 *
 * Spec: specs/14-navigation/design.md § Route migration table (you.tsx)
 *       specs/14-navigation/tasks.md T-14.3.4
 *
 * STUB: 14-navigation reserves the route slot only. The real Progress/You
 * screen content (streak hero, milestones, body row, recent PRs, the avatar
 * header that opens the ProfileDrawer) is owned by `06-progress-goals`,
 * which replaces this placeholder when its frontend ships.
 */
export function YouContainer() {
  return (
    <ComingSoon
      icon="stats-chart-outline"
      title="You"
      description="Your progress, streaks and PRs land here as 06-progress-goals ships."
      testID="you-tab"
    />
  );
}
