import { useCallback, useState } from "react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { View } from "@tamagui/core";
import type { MealSlot } from "@/domain/models/nutrition";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import type { MealprintTab } from "@/ui/presenters/mealprint/MealprintHomePresenter";
import { MealprintLockedPresenter } from "@/ui/presenters/mealprint/MealprintLockedPresenter";
import { MealprintStatePresenter } from "@/ui/presenters/mealprint/MealprintStatePresenter";
import { MealprintDayContainer } from "./MealprintDayContainer";
import { MealprintOneMealContainer } from "./MealprintOneMealContainer";

const MEAL_SLOTS: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "snack",
  "dinner",
];

/**
 * <MealprintContainer> — the Mealprint page (PER-134, canvas N15–N27). One
 * entry, one screen: One meal | Whole day. Without Premium+ it is the locked
 * page (N26). Each tab is its own container, so switching tabs starts that
 * flow afresh.
 *
 * Route params: `mode` (meal | day), and for One meal an optional `slot` and
 * `userMealId` (Add to a meal → Suggest, a plan's gap row), which only pick
 * where the chosen idea is logged.
 */
export function MealprintContainer() {
  const params = useLocalSearchParams<{
    mode?: string;
    slot?: string;
    userMealId?: string;
  }>();
  const gate = useMealprintGate();
  const online = useOnlineStatus();
  const [tab, setTab] = useState<MealprintTab>(
    params.mode === "day" ? "day" : "meal",
  );
  const slot = MEAL_SLOTS.find((s) => s === params.slot) ?? null;
  const userMealId = params.userMealId ? params.userMealId : null;

  const onClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/fuel" as Href);
  }, []);

  if (!gate.isResolved) {
    // The subscription isn't known yet. Offline with nothing cached, it
    // never will be until a connection comes back.
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
      <View
        flex={1}
        backgroundColor="$bg"
        alignItems="center"
        justifyContent="center"
        testID="mealprint-loading"
      >
        <PLogoDrawLoader />
      </View>
    );
  }

  if (!gate.allowed) {
    return (
      <MealprintLockedPresenter onBack={onClose} onUpgrade={gate.onUpgrade} />
    );
  }

  return tab === "meal" ? (
    <MealprintOneMealContainer
      onTab={setTab}
      onClose={onClose}
      slot={slot}
      userMealId={userMealId}
    />
  ) : (
    <MealprintDayContainer onTab={setTab} onClose={onClose} />
  );
}
