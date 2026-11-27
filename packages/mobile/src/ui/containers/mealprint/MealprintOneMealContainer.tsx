import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import { useForm } from "react-hook-form";
import { getApiBaseUrl } from "@/adapters/api";
import { localIdFactory } from "@/application/commands/localId";
import { logAllTodayCommand } from "@/application/commands/mealprintDay.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  MEAL_SEARCH_FULL_MESSAGE,
  addNotWantedMeals,
  draftFromSuggestion,
  type MealprintDraft,
  type MealSuggestion,
  type NotWantedMeal,
  type SuggestOccasion,
  type SuggestShape,
} from "@/domain/models/mealprint";
import type { LogEntryInput, MealSlot } from "@/domain/models/nutrition";
import { defaultMealSlot } from "@/domain/services/nutrition.service";
import {
  activeUserMeals,
  defaultUserMealIdForSlot,
  logTargetForUserMeal,
} from "@/domain/services/userMeals.service";
import { firstMessage } from "@/shared/form";
import { localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import {
  mealprintSteerResolver,
  type MealprintSteerValues,
} from "@/ui/forms/mealprintForms";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetFuelToday } from "@/ui/hooks/useGetFuelToday";
import {
  useMealSuggest,
  type MealSuggestFailure,
} from "@/ui/hooks/useMealSuggest";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import {
  MealprintHomePresenter,
  type MealprintTab,
} from "@/ui/presenters/mealprint/MealprintHomePresenter";
import { MealprintIdeasPresenter } from "@/ui/presenters/mealprint/MealprintIdeasPresenter";
import { MealprintLockedPresenter } from "@/ui/presenters/mealprint/MealprintLockedPresenter";
import { MealprintReviewPresenter } from "@/ui/presenters/mealprint/MealprintReviewPresenter";
import {
  MealprintStatePresenter,
  type MealprintState,
} from "@/ui/presenters/mealprint/MealprintStatePresenter";
import { MealprintWorkingPresenter } from "@/ui/presenters/mealprint/MealprintWorkingPresenter";

/**
 * <MealprintOneMealContainer> — Mealprint One meal (PER-134, canvas N15 →
 * N16 → N17 → N18, states N27). Reuses `useMealSuggest` and the suggestion
 * draft model; only the screens are new.
 *
 * The suggestion is worked out against the whole day's remaining budget for
 * the day Log is on (`useFuelSheets().date`). "Log to" picks which of Your
 * meals the chosen idea goes into; it starts on the meal Mealprint was opened
 * for, else the meal for the time of day.
 *
 * Logging is offline-first like any food log: every ticked item is cached and
 * queued with its own key, then one drain sends them together.
 */

export type MealprintOneMealContainerProps = {
  onTab: (tab: MealprintTab) => void;
  onClose: () => void;
  /** Preset from Add to a meal / a plan's gap row. */
  slot: MealSlot | null;
  userMealId: string | null;
};

const EMPTY_SUGGESTIONS: readonly MealSuggestion[] = [];

/** "Mon 23 Nov" for a day Log is on that isn't today. */
const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** The state screen for a failed suggest call. */
export function suggestFailureState(
  failure: Pick<MealSuggestFailure, "status">,
): MealprintState {
  if (failure.status === 429) return "cap";
  if (failure.status === 422) return "none";
  return "down";
}

export function MealprintOneMealContainer({
  onTab,
  onClose,
  slot,
  userMealId,
}: MealprintOneMealContainerProps) {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const activeDate = useFuelSheets((s) => s.date);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const online = useOnlineStatus();
  const gate = useMealprintGate();
  const preferences = useMealprintPreferences(true);
  const fuel = useGetFuelToday(activeDate);
  const userMeals = useUserMeals();
  const suggest = useMealSuggest();
  const form = useForm<MealprintSteerValues>({
    resolver: mealprintSteerResolver,
    defaultValues: { steer: "" },
  });
  const steer = form.watch("steer");
  const steerError = firstMessage(form.formState.errors) ?? null;

  const [occasion, setOccasion] = useState<SuggestOccasion>("on_plan");
  const [shape, setShape] = useState<SuggestShape>("either");
  const [draft, setDraft] = useState<MealprintDraft | null>(null);
  const [logToId, setLogToId] = useState<string | null>(null);
  const [logToOpen, setLogToOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [added, setAdded] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const notWantedRef = useRef<NotWantedMeal[]>([]);
  const confirmingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const isToday = activeDate === localDayISO();
  const dayName = DAY.format(new Date(`${activeDate}T12:00:00`));

  const left = useMemo(() => {
    const t = fuel.data?.targets;
    if (!fuel.data || !t) return null;
    const c = fuel.data.consumed;
    return {
      kcal: Math.max(0, t.dailyKcal - c.kcal),
      proteinG: Math.max(0, t.proteinG - c.proteinG),
      carbsG: Math.max(0, t.carbsG - c.carbsG),
      fatG: Math.max(0, t.fatG - c.fatG),
    };
  }, [fuel.data]);

  const meals = useMemo(
    () => activeUserMeals(userMeals.meals),
    [userMeals.meals],
  );
  const defaultMealId = useMemo(() => {
    if (userMealId && meals.some((m) => m.id === userMealId)) return userMealId;
    return (
      defaultUserMealIdForSlot(meals, slot ?? defaultMealSlot(new Date())) ??
      meals[0]?.id ??
      null
    );
  }, [meals, slot, userMealId]);
  const logToMeal =
    meals.find((m) => m.id === (logToId ?? defaultMealId)) ?? null;

  const suggestions = suggest.result?.suggestions ?? EMPTY_SUGGESTIONS;

  const search = useCallback(
    (history: NotWantedMeal[], steerText: string) => {
      if (!online || suggest.stage === "generating") return;
      notWantedRef.current = history;
      setSearchError(null);
      setDraft(null);
      void suggest.run({
        notWantedMeals: history,
        shape: occasion === "cheat_meal" ? "either" : shape,
        date: activeDate,
        steer: steerText === "" ? undefined : steerText,
        occasion,
      });
    },
    [online, suggest, occasion, shape, activeDate],
  );

  const onSubmit = useCallback(() => {
    void form.handleSubmit((values) => search([], values.steer.trim()))();
  }, [form, search]);

  const onMore = useCallback(() => {
    const history = addNotWantedMeals(
      notWantedRef.current,
      suggestions.map((meal) => ({
        name: meal.name,
        ingredients: meal.items.map((item) => item.name),
      })),
    );
    if (!history) {
      setSearchError(MEAL_SEARCH_FULL_MESSAGE);
      return;
    }
    search(history, form.getValues("steer").trim());
  }, [suggestions, search, form]);

  const onSelect = useCallback(
    (index: number) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;
      void Haptics.selectionAsync();
      setDraft(
        draftFromSuggestion(
          suggestion,
          logToMeal?.logSlot ?? slot ?? defaultMealSlot(new Date()),
        ),
      );
      setAdded(false);
      setConfirmError(false);
    },
    [suggestions, logToMeal, slot],
  );

  const onToggleItem = useCallback((index: number) => {
    setDraft((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            items: prev.items.map((item, i) =>
              i === index ? { ...item, on: !item.on } : item,
            ),
          },
    );
  }, []);

  const onLog = useCallback(async () => {
    if (confirmingRef.current || draft === null || userId === null) return;
    const kept = draft.items.filter((item) => item.on);
    if (kept.length === 0) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      const where: Pick<LogEntryInput, "mealSlot" | "userMealId"> = logToMeal
        ? logTargetForUserMeal(logToMeal)
        : { mealSlot: draft.slot };
      const loggedAt = loggedAtNoonUtc(activeDate);
      const inputs: LogEntryInput[] = kept.map((item) => ({
        // Logged by reference: the server re-derives the macros. The ones
        // sent are the phone's optimistic fallback (a Mealprint candidate is
        // rarely in the food cache) and the name stops the row reading
        // "Logged food".
        ...(item.kind === "recipe"
          ? { recipeId: item.candidateId }
          : item.kind === "meal"
            ? { mealId: item.candidateId }
            : { foodId: item.candidateId }),
        ...where,
        servings: item.servings,
        kcal: item.kcal,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        customName: item.name,
        loggedAt,
      }));
      logAllTodayCommand(
        { storage, userId, idFactory: localIdFactory },
        inputs,
      );
      notifyMutated();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdded(true);
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[Mealprint] queue flush failed:", err);
      }
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, 900);
    } catch {
      notifyMutated();
      setConfirmError(true);
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }, [
    draft,
    userId,
    logToMeal,
    activeDate,
    storage,
    auth,
    notifyMutated,
    onClose,
  ]);

  const onPreferences = useCallback(() => {
    router.push("/(app)/fuel/preferences?mode=editor" as Href);
  }, []);

  const backToHome = useCallback(() => {
    suggest.reset();
    setDraft(null);
    setSearchError(null);
  }, [suggest]);

  const dietaryPatterns = preferences.data?.dietaryPatterns ?? [];
  const serverPartial = suggest.result?.partialEnforcementOnly ?? false;

  // -- Which screen ----------------------------------------------------------

  if (draft !== null) {
    const kept = draft.items.filter((i) => i.on);
    const sum = (k: "kcal" | "proteinG" | "carbsG" | "fatG") =>
      kept.reduce((t, i) => t + i[k], 0);
    return (
      <MealprintReviewPresenter
        name={draft.suggestion.name}
        totals={{
          kcal: sum("kcal"),
          proteinG: sum("proteinG"),
          carbsG: sum("carbsG"),
          fatG: sum("fatG"),
        }}
        items={draft.items.map((i) => ({
          name: i.name,
          serving: i.servingLabel,
          kcal: i.kcal,
          on: i.on,
        }))}
        onToggleItem={onToggleItem}
        logToName={logToMeal?.name ?? "Pick a meal"}
        logToMeals={meals.map((m) => ({ id: m.id, name: m.name }))}
        logToSelectedId={logToMeal?.id ?? ""}
        logToOpen={logToOpen}
        onOpenLogTo={() => setLogToOpen(true)}
        onPickLogTo={(id) => {
          setLogToId(id);
          setLogToOpen(false);
        }}
        onCloseLogTo={() => setLogToOpen(false)}
        dietaryPatterns={dietaryPatterns}
        serverPartialEnforcementOnly={serverPartial}
        confirming={confirming}
        added={added}
        errorMessage={
          confirmError
            ? "Some items may not have been added. Check your meal log before trying again."
            : null
        }
        onLog={() => void onLog()}
        onBackToIdeas={() => setDraft(null)}
      />
    );
  }

  if (suggest.stage === "generating") {
    return (
      <MealprintWorkingPresenter
        body="Fitting a meal to your remaining macros and preferences. This takes a few seconds."
        onBack={onClose}
        onCancel={onClose}
      />
    );
  }

  if (suggest.stage === "error" && suggest.failure) {
    if (suggest.failure.entitlementDenied) {
      return (
        <MealprintLockedPresenter onBack={onClose} onUpgrade={gate.onUpgrade} />
      );
    }
    const state = online ? suggestFailureState(suggest.failure) : "offline";
    return (
      <MealprintStatePresenter
        state={state}
        onBack={backToHome}
        onPrimary={() => {
          if (state === "down") void suggest.retry();
          else backToHome();
        }}
        onSecondary={onClose}
      />
    );
  }

  if (suggest.stage === "ready" && suggest.result) {
    const empty = suggest.result.emptyReason;
    if (empty !== null || suggestions.length === 0) {
      const state: MealprintState =
        empty === "no_targets"
          ? "no_target"
          : empty === "budget_exhausted"
            ? "full"
            : "none";
      return (
        <MealprintStatePresenter
          state={state}
          onBack={backToHome}
          onPrimary={backToHome}
          onSecondary={onClose}
        />
      );
    }
    return (
      <MealprintIdeasPresenter
        ideas={suggestions.map((s) => ({
          name: s.name,
          reason: s.reason,
          kcal: s.kcal,
          proteinG: s.proteinG,
          carbsG: s.carbsG,
          fatG: s.fatG,
        }))}
        left={suggest.result.remaining}
        leftLabel={isToday ? "kcal left today" : `kcal left on ${dayName}`}
        dietaryPatterns={dietaryPatterns}
        serverPartialEnforcementOnly={serverPartial}
        onBack={backToHome}
        onPreferences={onPreferences}
        onSelect={onSelect}
        onMore={onMore}
        moreDisabled={!online}
        notice={searchError}
      />
    );
  }

  if (!online) {
    return (
      <MealprintStatePresenter
        state="offline"
        onBack={onClose}
        onPrimary={onClose}
        onSecondary={onClose}
      />
    );
  }

  return (
    <MealprintHomePresenter
      tab="meal"
      onTab={onTab}
      onBack={onClose}
      onPreferences={onPreferences}
      meal={{
        leftLabel: isToday ? "Left today" : `Left on ${dayName}`,
        left,
        occasion,
        onOccasion: setOccasion,
        shape,
        onShape: setShape,
      }}
      steer={steer}
      onSteer={(text) => form.setValue("steer", text, { shouldValidate: true })}
      steerError={steerError}
      notice={searchError}
      onSubmit={onSubmit}
      submitDisabled={!online}
    />
  );
}
