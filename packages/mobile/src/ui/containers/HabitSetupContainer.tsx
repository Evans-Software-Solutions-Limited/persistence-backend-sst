import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetHabitConfig } from "@/ui/hooks/useGetHabitConfig";
import { useGetClientHabitConfig } from "@/ui/hooks/useGetClientHabitConfig";
import {
  useConfigureHabit,
  useDisableHabit,
} from "@/ui/hooks/useConfigureHabit";
import { useUseFreezeToken } from "@/ui/hooks/useUseFreezeToken";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { HabitSetupPresenter } from "@/ui/presenters/habits/HabitSetupPresenter";
import {
  HABIT_ORDER,
  defaultHabitConfig,
  type HabitCategory,
  type HabitConfig,
} from "@/domain/models/habit-config";
import type { HabitCompletion } from "@/domain/models/habit-completion";
import { deriveCollectionStreak } from "@/domain/services";

/**
 * <HabitSetupContainer> — wires the habit-setup screen (18-habit-setup, Phase
 * 18.7 — T-18.7.7). Self mode (athlete) reads/writes the caller's own config;
 * coach mode (`clientId` set) reads/writes a client's config via the trainer
 * routes, showing attribution + locking nothing (the coach owns the edits).
 *
 * The collection streak hero reads the server `habit_streak` row when present
 * (server wins), falling back to the offline `deriveCollectionStreak` mirror.
 * At-risk is derived from the offline mirror (this week not yet safe + no
 * freeze queued) so the banner shows without a round-trip.
 */
export function HabitSetupContainer({ clientId }: { clientId?: string } = {}) {
  const router = useRouter();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const isCoachView = !!clientId;

  const selfConfig = useGetHabitConfig();
  const clientConfig = useGetClientHabitConfig(clientId);
  const configsList: HabitConfig[] = isCoachView
    ? clientConfig.configs
    : selfConfig.configs;

  const configure = useConfigureHabit(clientId);
  const disable = useDisableHabit(clientId);
  const freeze = useUseFreezeToken();
  const streaks = useGetStreaks();

  const [skipped, setSkipped] = useState(false);

  // Key the config list by category so the presenter can index directly; any
  // missing category falls back to its disabled default (defensive — the hooks
  // already merge all five).
  const configsByCategory = useMemo(() => {
    const map = {} as Record<HabitCategory, HabitConfig>;
    for (const category of HABIT_ORDER) {
      map[category] =
        configsList.find((c) => c.category === category) ??
        defaultHabitConfig(category);
    }
    return map;
  }, [configsList]);

  // The single collection habit streak row (weekly, no source goal).
  const collectionStreak = useMemo(
    () =>
      (streaks.data ?? []).find(
        (s) => s.streakType === "habit_streak" && s.sourceGoalId === null,
      ) ?? null,
    [streaks.data],
  );

  // Offline mirror of the collection streak (self only — the coach reads the
  // server row for the client, not a local cache).
  const offlineStreak = useMemo(() => {
    if (isCoachView || !userId) return 0;
    const completions = storage.getCachedHabitCompletions(userId);
    const byGoal = new Map<string, HabitCompletion[]>();
    for (const c of completions) {
      const rows = byGoal.get(c.goalId) ?? [];
      rows.push(c);
      byGoal.set(c.goalId, rows);
    }
    return deriveCollectionStreak(configsList, byGoal, new Date());
  }, [isCoachView, userId, configsList, storage]);

  const streak = collectionStreak?.currentCount ?? offlineStreak;
  const longest = Math.max(collectionStreak?.longestCount ?? 0, streak);
  const freezeTokens = collectionStreak?.freezeTokens ?? 0;
  // At risk when the offline walk drops the current week vs the previous count
  // and there's no server "paused" state. Best-effort: the server's mid-week
  // `streak_at_risk` is authoritative, but this lights the banner offline.
  const atRisk = useMemo(() => {
    if (isCoachView) return false;
    if (collectionStreak?.status === "paused") return false;
    return streak > 0 && offlineStreak < streak;
  }, [isCoachView, collectionStreak?.status, streak, offlineStreak]);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const onToggle = useCallback(
    (category: HabitCategory, next: boolean) => {
      const cfg = configsByCategory[category];
      if (next) {
        void configure.mutate({
          category,
          targetValue: cfg.targetValue,
          daysPerWeek: cfg.daysPerWeek ?? undefined,
          tolerancePct: cfg.tolerancePct ?? undefined,
        });
      } else {
        void disable.mutate(category);
      }
    },
    [configsByCategory, configure, disable],
  );

  const onTargetChange = useCallback(
    (category: HabitCategory, next: number) => {
      const cfg = configsByCategory[category];
      void configure.mutate({
        category,
        targetValue: next,
        daysPerWeek: cfg.daysPerWeek ?? undefined,
        tolerancePct: cfg.tolerancePct ?? undefined,
      });
    },
    [configsByCategory, configure],
  );

  const onFreqChange = useCallback(
    (category: HabitCategory, next: number) => {
      const cfg = configsByCategory[category];
      void configure.mutate({
        category,
        targetValue: cfg.targetValue,
        daysPerWeek: next,
        tolerancePct: cfg.tolerancePct ?? undefined,
      });
    },
    [configsByCategory, configure],
  );

  const onLeniencyChange = useCallback(
    (category: HabitCategory, next: number) => {
      const cfg = configsByCategory[category];
      void configure.mutate({
        category,
        targetValue: cfg.targetValue,
        daysPerWeek: cfg.daysPerWeek ?? undefined,
        tolerancePct: next,
      });
    },
    [configsByCategory, configure],
  );

  const onSpendFreeze = useCallback(() => {
    if (!collectionStreak || freezeTokens <= 0 || skipped) return;
    setSkipped(true);
    void freeze.mutate(collectionStreak.id, "skip").then((result) => {
      if (result.ok) {
        void streaks.refresh();
      } else {
        // Revert the optimistic CTA state if the spend failed.
        setSkipped(false);
      }
    });
  }, [collectionStreak, freezeTokens, skipped, freeze, streaks]);

  const onAdjustNutrition = useCallback(() => {
    // Calories deep-link → the Fuel Targets editor (M9). Coach view has no
    // equivalent client-side editor, so it's a no-op there.
    if (isCoachView) return;
    router.push("/(app)/fuel/targets");
  }, [router, isCoachView]);

  return (
    <HabitSetupPresenter
      configs={configsByCategory}
      streak={streak}
      longest={longest}
      freezeTokens={freezeTokens}
      atRisk={atRisk}
      skipped={skipped}
      intro={
        isCoachView
          ? "Set each target and how often they'll hit it. Changes start next Monday."
          : undefined
      }
      coachSubtitle={
        isCoachView ? "You're editing this client's habits" : undefined
      }
      onBack={onBack}
      onToggle={onToggle}
      onTargetChange={onTargetChange}
      onFreqChange={onFreqChange}
      onLeniencyChange={onLeniencyChange}
      onSpendFreeze={onSpendFreeze}
      onAdjustNutrition={onAdjustNutrition}
    />
  );
}
