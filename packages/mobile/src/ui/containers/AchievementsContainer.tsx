import { useCallback, useMemo } from "react";
import { useGetAchievements } from "@/ui/hooks/useGetAchievements";
import { useGetPRHistory } from "@/ui/hooks/useGetPRHistory";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { AchievementsPresenter } from "@/ui/presenters/AchievementsPresenter";
import { buildMilestoneTiers } from "./buildMilestoneTiers";

const PR_HISTORY_LIMIT = 20;

/**
 * <AchievementsContainer> — wires the achievements + PR-history hooks (plus
 * the shared milestone-tier mapping) into <AchievementsPresenter>. Reached
 * from the profile drawer's "Achievements" row (app/(app)/achievements.tsx),
 * replacing the previous coming-soon placeholder.
 *
 * Same cache-first loading/error posture as <YouContainer>: renders present
 * data immediately, only blocking on the loader/error screen when NEITHER
 * source has any data yet.
 */
export function AchievementsContainer() {
  const achievements = useGetAchievements();
  const prs = useGetPRHistory(PR_HISTORY_LIMIT);
  const profile = useProfilePage();
  const weightUnit = profile.payload?.profile.weightUnit ?? "kg";

  const milestones = useMemo(
    () => buildMilestoneTiers(achievements.data ?? []),
    [achievements.data],
  );
  const earnedCount = useMemo(
    () => milestones.filter((m) => m.earned).length,
    [milestones],
  );

  const refreshAchievements = achievements.refresh;
  const refreshPRs = prs.refresh;
  const onRefresh = useCallback(() => {
    void Promise.all([refreshAchievements(), refreshPRs()]);
  }, [refreshAchievements, refreshPRs]);

  const isLoading =
    (achievements.isRefreshing ||
      (achievements.isStale && achievements.error === null)) &&
    achievements.data === null &&
    prs.data === null;

  const error = achievements.data === null ? achievements.error : null;

  return (
    <AchievementsPresenter
      milestones={milestones}
      earnedCount={earnedCount}
      achievements={achievements.data ?? []}
      prHistory={prs.data ?? []}
      weightUnit={weightUnit}
      isLoading={isLoading}
      isRefreshing={achievements.isRefreshing || prs.isRefreshing}
      error={error}
      onRefresh={onRefresh}
    />
  );
}
