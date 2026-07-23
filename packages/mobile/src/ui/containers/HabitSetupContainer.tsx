import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";

import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useDashboard } from "@/ui/hooks/useDashboard";
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
import { preferredVolumeUnit } from "@/shared/utils";

/**
 * <HabitSetupContainer> — wires the habit-setup screen (18-habit-setup, Phase
 * 18.7 — T-18.7.7). Self mode (athlete) reads/writes the caller's own config;
 * coach mode (`clientId` set) reads/writes a client's config via the trainer
 * routes, showing attribution + locking nothing (the coach owns the edits).
 *
 * DRAFT + explicit SAVE model. The screen holds a local draft of all five
 * configs; toggles/targets/frequency/leniency mutate the DRAFT only (instant,
 * no server write). Nothing is written until the user taps Save, which commits
 * the diff against the last-saved baseline (a configure PUT per enabled edit, a
 * disable DELETE per turned-off habit) then reconciles. Back discards the draft
 * simply by navigating away (nothing was written).
 *
 * This replaces the old per-toggle mutate approach, which wrote a *pending*
 * `{enabled:false}` on disable (the backend defers disables to next Monday) but
 * left the live row enabled — so the switch, driven by the live `enabled`, snap-
 * ped back ON on reload and the habit couldn't be turned off. The draft model
 * shows off instantly, and the pending-aware BASELINE (below) keeps a *saved*
 * disable off on re-open.
 *
 * The collection streak hero reads the server `habit_streak` row when present
 * (server wins), falling back to the offline `deriveCollectionStreak` mirror.
 * At-risk is derived from the offline mirror (this week not yet safe + no
 * freeze queued) so the banner shows without a round-trip.
 */
export function HabitSetupContainer({
  clientId,
  clientName,
}: { clientId?: string; clientName?: string } = {}) {
  const router = useRouter();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const isCoachView = !!clientId;

  // Device-QA #5/#7 — the water target's display unit follows the SELF
  // viewer's `preferredUnits` (default litres). Coach mode has no read of the
  // CLIENT's preference anywhere in the client-detail contract today (adding
  // one is backend plumbing, out of scope for this light-touch fix — flagged
  // in the PR), so coach view always renders litres, matching the pre-fix
  // behaviour exactly; `preferredVolumeUnit(undefined)` already defaults
  // there for free.
  const dashboard = useDashboard();
  const volumeUnit = preferredVolumeUnit(
    isCoachView ? undefined : dashboard.payload?.profile.preferredUnits,
  );

  const selfConfig = useGetHabitConfig();
  const clientConfig = useGetClientHabitConfig(clientId);
  const configsList: HabitConfig[] = isCoachView
    ? clientConfig.configs
    : selfConfig.configs;

  const configure = useConfigureHabit(clientId);
  const disable = useDisableHabit(clientId);
  const freeze = useUseFreezeToken();
  const streaks = useGetStreaks();

  // A saved edit/disable is deferred server-side to next Monday (the loaded
  // config carries a `pending` block until the rollover). The draft+baseline
  // flattens pending away for a clean control, so surface it at the screen
  // level instead — otherwise the deferral (esp. "I turned this off") is
  // invisible, which is exactly what read as broken. Computed from the raw
  // loaded configs, independent of the draft.
  const hasDeferredChanges = useMemo(
    () => configsList.some((c) => c.pending != null),
    [configsList],
  );

  const [skipped, setSkipped] = useState(false);
  const [saving, setSaving] = useState(false);

  // Transient "Saved" confirmation (QA-6: Save had no success feedback,
  // making a persisted-but-invisible write read as "tapping Save does
  // nothing"). Mirrors the "Copied" transient-local-state pattern used by
  // AddClientSheetContainer — no toast/snackbar primitive exists in the app.
  const [justSaved, setJustSaved] = useState(false);
  const justSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    return () => {
      if (justSavedTimeoutRef.current)
        clearTimeout(justSavedTimeoutRef.current);
    };
  }, []);

  // Baseline = the user's last SAVED INTENT, keyed by category. We start from
  // the loaded live config, but apply any queued pending edit OVER it so the
  // baseline reflects what the user last committed — not just the live row.
  // This is the fix for the re-open snap-back: a previously-saved disable lands
  // as `pending.enabled = false` over a live `enabled = true`, so the baseline
  // (and therefore the draft + the switch) shows OFF on load. Missing categories
  // fall back to their disabled default.
  const baseline = useMemo(() => {
    const map = {} as Record<HabitCategory, HabitConfig>;
    for (const category of HABIT_ORDER) {
      const live =
        configsList.find((c) => c.category === category) ??
        defaultHabitConfig(category);
      const pending = live.pending;
      map[category] = {
        ...live,
        enabled: pending?.enabled ?? live.enabled,
        targetValue: pending?.targetValue ?? live.targetValue,
        daysPerWeek:
          pending && pending.daysPerWeek !== undefined
            ? pending.daysPerWeek
            : live.daysPerWeek,
        tolerancePct:
          pending && pending.tolerancePct !== undefined
            ? pending.tolerancePct
            : live.tolerancePct,
        // The draft edits the last-saved intent, not the queued edit itself —
        // drop `pending` so the presenter renders a clean control (no stale
        // "Starts Monday" tag on top of the draft value).
        pending: null,
      };
    }
    return map;
  }, [configsList]);

  const [draft, setDraft] = useState<Record<HabitCategory, HabitConfig> | null>(
    null,
  );

  // A stable signature of a config set's editable fields — used to detect a
  // baseline change (re-seed) and whether the draft has been touched.
  const signatureOf = useCallback(
    (configs: Record<HabitCategory, HabitConfig>) =>
      HABIT_ORDER.map((category) => {
        const c = configs[category];
        return `${category}:${c.enabled}:${c.targetValue}:${c.daysPerWeek}:${c.tolerancePct}`;
      }).join("|"),
    [],
  );

  const baselineSignature = useMemo(
    () => signatureOf(baseline),
    [baseline, signatureOf],
  );

  // `dirty` = the draft diverges from the baseline on any editable field.
  const dirty = useMemo(() => {
    if (!draft) return false;
    return signatureOf(draft) !== baselineSignature;
  }, [draft, baselineSignature, signatureOf]);

  // Seed the draft when the baseline first resolves, and re-seed on a baseline
  // change so long as the user hasn't edited the draft AWAY from the baseline it
  // was last seeded from. We compare the draft to the *previously seeded*
  // baseline (not the new one) so a background refresh / post-save reconcile
  // re-seeds cleanly, while genuine in-progress edits are preserved.
  const seededSignature = useRef<string | null>(null);
  useEffect(() => {
    if (draft === null) {
      setDraft(baseline);
      seededSignature.current = baselineSignature;
      return;
    }
    const draftUntouched = signatureOf(draft) === seededSignature.current;
    if (draftUntouched && baselineSignature !== seededSignature.current) {
      setDraft(baseline);
      seededSignature.current = baselineSignature;
    }
  }, [draft, baseline, baselineSignature, signatureOf]);

  // The presenter always renders the draft (falling back to the baseline while
  // the draft is still null on the very first render before the effect runs).
  const presented = draft ?? baseline;

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
    // Discard is implicit: nothing was written to the server, so navigating
    // away drops the unsaved draft.
    if (router.canGoBack()) router.back();
  }, [router]);

  // --- Draft mutators — local only, instant, no server write ---
  const patchDraft = useCallback(
    (category: HabitCategory, patch: Partial<HabitConfig>) => {
      setDraft((prev) => {
        const base = prev ?? baseline;
        return { ...base, [category]: { ...base[category], ...patch } };
      });
    },
    [baseline],
  );

  const onToggle = useCallback(
    (category: HabitCategory, next: boolean) => {
      patchDraft(category, { enabled: next });
    },
    [patchDraft],
  );

  const onTargetChange = useCallback(
    (category: HabitCategory, next: number) => {
      patchDraft(category, { targetValue: next });
    },
    [patchDraft],
  );

  const onFreqChange = useCallback(
    (category: HabitCategory, next: number) => {
      patchDraft(category, { daysPerWeek: next });
    },
    [patchDraft],
  );

  const onLeniencyChange = useCallback(
    (category: HabitCategory, next: number) => {
      patchDraft(category, { tolerancePct: next });
    },
    [patchDraft],
  );

  const configureMutate = configure.mutate;
  const disableMutate = disable.mutate;
  const reloadSelfConfig = selfConfig.reload;
  const refreshClientConfig = clientConfig.refresh;

  // Commit the draft: one write per category that diverges from the baseline.
  //  - draft enabled            → configure PUT (enable/edit).
  //  - was enabled, now disabled → disable DELETE.
  //  - both disabled            → no write.
  // Enable-then-disable before Save collapses back to the baseline (draft ==
  // baseline for that category) → no write, for free.
  const onSave = useCallback(async () => {
    if (saving || !dirty || !draft) return;
    setSaving(true);
    try {
      const writes: Promise<void>[] = [];
      for (const category of HABIT_ORDER) {
        const d = draft[category];
        const b = baseline[category];
        const changed =
          d.enabled !== b.enabled ||
          d.targetValue !== b.targetValue ||
          d.daysPerWeek !== b.daysPerWeek ||
          d.tolerancePct !== b.tolerancePct;
        if (!changed) continue;
        if (d.enabled) {
          writes.push(
            configureMutate({
              category,
              targetValue: d.targetValue,
              daysPerWeek: d.daysPerWeek ?? undefined,
              tolerancePct: d.tolerancePct ?? undefined,
            }),
          );
        } else if (b.enabled) {
          // was enabled, now off → disable.
          writes.push(disableMutate(category));
        }
        // else: both disabled — nothing to write.
      }
      await Promise.all(writes);
      // Reconcile so the baseline picks up the server's queued-pending state
      // (self reads its own cache; coach re-fetches the client row).
      if (isCoachView) await refreshClientConfig();
      else reloadSelfConfig();
      // Re-seed the draft from the freshly reconciled baseline (clears dirty).
      // The baseline recompute is async (depends on the reload/refresh landing
      // in state), so mark the draft null to force a re-seed on the next render.
      setDraft(null);
      seededSignature.current = null;
      // Success feedback (QA-6) — only reached once the writes + reconcile
      // above succeeded (a rejection skips straight to `finally`).
      if (justSavedTimeoutRef.current)
        clearTimeout(justSavedTimeoutRef.current);
      setJustSaved(true);
      justSavedTimeoutRef.current = setTimeout(() => setJustSaved(false), 2000);
      // Redirect back to where the user came from (the coach's Client Detail,
      // or the athlete's previous screen) once the save has landed — the
      // destination re-fetches on focus and shows the saved habits, so the
      // setup sheet is a task the user completes and leaves, not a dead-end
      // that just flashes "Saved" in place.
      if (router.canGoBack()) router.back();
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    dirty,
    draft,
    baseline,
    configureMutate,
    disableMutate,
    isCoachView,
    refreshClientConfig,
    reloadSelfConfig,
    router,
  ]);

  const canSave = dirty && !saving;

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
      configs={presented}
      streak={streak}
      longest={longest}
      freezeTokens={freezeTokens}
      atRisk={atRisk}
      skipped={skipped}
      isCoach={isCoachView}
      volumeUnit={volumeUnit}
      canSave={canSave}
      saving={saving}
      justSaved={justSaved}
      deferredChangesPending={hasDeferredChanges}
      title={
        isCoachView
          ? clientName
            ? `${clientName}'s habits`
            : "Client's habits"
          : undefined
      }
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
      onSave={onSave}
    />
  );
}
