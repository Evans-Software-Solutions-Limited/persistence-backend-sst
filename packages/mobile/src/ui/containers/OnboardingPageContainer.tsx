import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { Alert, BackHandler } from "react-native";

import {
  type CoachClientBand,
  type OnboardingIntentKey,
  type OnboardingPage,
  type OnboardingPath,
} from "@/domain/models/onboarding";
import { recommendOnboardingPlan } from "@/domain/services/onboardingRecommendation";
import { EditProfileContainer } from "@/ui/containers/EditProfileContainer";
import { HabitSetupContainer } from "@/ui/containers/HabitSetupContainer";
import { SubscriptionSelectionContainer } from "@/ui/containers/SubscriptionSelectionContainer";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  NUTRITION_ONBOARDING_OPTIONS,
  OnboardingAccountConfirmationPresenter,
  OnboardingIntentPresenter,
  OnboardingOfflinePlansPresenter,
  OnboardingRolePresenter,
  OnboardingWelcomePresenter,
  TRAINING_ONBOARDING_OPTIONS,
} from "@/ui/presenters/OnboardingPresenter";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { View } from "@tamagui/core";
import { useOnboarding } from "@/ui/state/OnboardingProvider";

export const ONBOARDING_ROUTES: Record<OnboardingPage, string> = {
  welcome: "/(onboarding)/welcome",
  profile: "/(onboarding)/profile",
  role: "/(onboarding)/role",
  habits: "/(onboarding)/habits",
  nutrition: "/(onboarding)/nutrition",
  train: "/(onboarding)/train",
  recommendation: "/(onboarding)/recommendation",
};

export function OnboardingPageContainer({ page }: { page: OnboardingPage }) {
  const router = useRouter();
  const onboarding = useOnboarding();
  const subscription = useMySubscription();
  // Still in flight: treat as UNKNOWN, never as free. The read applies a
  // pending founding grant server-side, so the journey waits on it rather
  // than risk showing the paywall to somebody who has already paid.
  //
  // A SETTLED FAILURE is not "unknown", though — it is an answer we could not
  // get, and it never becomes one on its own (the query retries three times
  // and then stops). Blocking on it would strand a new user on a loading
  // screen for the rest of the session over one bad request or a moment
  // offline, which is a worse failure than the one this guard exists to
  // prevent: an entitlement that arrives late is applied on the next launch,
  // whereas an onboarding that never renders leaves nowhere to go.
  const isOnline = useOnlineStatus();
  const isSubscriptionUnknown =
    subscription.data === undefined && !subscription.isError;
  // Offline, the entitlement read cannot settle at all — a hanging request
  // never even becomes `isError`. Waiting on it is how the plan picker turned
  // into an indefinite spinner, so offline we stop waiting and degrade the one
  // page that needs the network (see the `recommendation` branch below).
  const isWaitingOnSubscription = isSubscriptionUnknown && isOnline;
  const isEntitled =
    subscription.data !== undefined && subscription.data.tierName !== "free";
  const [showOthers, setShowOthers] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const viewedRef = useRef<OnboardingPage | null>(null);
  const navigationInFlightRef = useRef(false);

  const state = onboarding.state;

  // Expo Router owns the navigation dependency, so this also works in a clean
  // install without importing React Navigation transitively. The callback is
  // stable: its cleanup runs on a real blur, not on each provider state update.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => {
        setIsFocused(false);
        navigationInFlightRef.current = false;
      };
    }, []),
  );

  useEffect(() => {
    if (
      !isFocused ||
      navigationInFlightRef.current ||
      !state ||
      onboarding.isLoading ||
      state.status !== "in_progress"
    )
      return;
    if (state.currentPage !== page) {
      router.replace(ONBOARDING_ROUTES[state.currentPage] as Href);
      return;
    }
    if (viewedRef.current !== page) {
      viewedRef.current = page;
      onboarding.track("onboarding_page_viewed", { page });
      if (page === "recommendation") {
        onboarding.track(
          "onboarding_recommendation_viewed",
          isEntitled ? { onboarding_mode: "account_only" } : undefined,
        );
      }
    }
  }, [state, onboarding, page, router, isFocused, isEntitled]);

  // Re-check the entitlement on arrival at the recommendation page, in case
  // it landed mid-journey (e.g. the user confirmed their email — and the
  // founding grant redeemed against it — in another app while onboarding).
  // The subscription read is otherwise only kept fresh by a foreground
  // listener mounted at the authenticated app root, which isn't mounted
  // while this onboarding stack is.
  useEffect(() => {
    if (page === "recommendation" && isFocused) {
      void subscription.refetch();
    }
    // Deliberately keyed on [page, isFocused] only — `subscription` is a new
    // Tanstack Query result object on every render (including the refetch
    // this effect itself triggers), so including it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, isFocused]);

  const goTo = (next: OnboardingPage | null) => {
    if (next) router.push(ONBOARDING_ROUTES[next] as Href);
  };

  const complete = async () => {
    navigationInFlightRef.current = true;
    try {
      goTo(await onboarding.completePage(page));
    } catch (error) {
      navigationInFlightRef.current = false;
      throw error;
    }
  };
  const skip = async () => {
    navigationInFlightRef.current = true;
    try {
      const next = await onboarding.skipPage(page);
      if (next) goTo(next);
      else {
        await onboarding.completeJourney();
        router.replace("/(app)/(tabs)");
      }
    } catch (error) {
      navigationInFlightRef.current = false;
      throw error;
    }
  };
  const back = useCallback(async () => {
    navigationInFlightRef.current = true;
    try {
      const previous = await onboarding.goBack();
      // Pop to a previously visited onboarding page so the native stack uses
      // its reverse transition. On a resumed journey where that page is not in
      // this process's history, dismissTo safely falls back to replace.
      router.dismissTo(ONBOARDING_ROUTES[previous] as Href);
    } catch (error) {
      navigationInFlightRef.current = false;
      throw error;
    }
  }, [onboarding, router]);

  useFocusEffect(
    useCallback(() => {
      if (page === "welcome") return;
      const backHandlerSubscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          void back();
          return true;
        },
      );
      return () => backHandlerSubscription.remove();
    }, [back, page]),
  );

  const confirmDismissJourney = () => {
    Alert.alert(
      "Skip setup?",
      "Are you sure? This dismisses the setup journey and takes you straight to Home. You can update your profile, habits and preferences later.",
      [
        { text: "Keep setting up", style: "cancel" },
        {
          text: "Skip setup",
          style: "destructive",
          onPress: () => {
            void onboarding
              .dismissJourney()
              .then(() => router.replace("/(app)/(tabs)"));
          },
        },
      ],
    );
  };

  const recommendation = useMemo(() => {
    if (!state) return null;
    return recommendOnboardingPlan({
      path: state.path ?? "athlete",
      coachClientBand: state.coachClientBand,
      intentKeys: state.intentKeys,
      currentTier: subscription.data?.tierName ?? "free",
    });
  }, [state, subscription.data?.tierName]);

  if (
    onboarding.isLoading ||
    isWaitingOnSubscription ||
    !state ||
    !recommendation
  ) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$bg"
      >
        <PLogoDrawLoader />
      </View>
    );
  }

  if (page === "welcome") {
    return (
      <OnboardingWelcomePresenter
        onContinue={() => void complete()}
        onSkip={confirmDismissJourney}
      />
    );
  }

  if (page === "profile") {
    return (
      <EditProfileContainer
        onboarding
        onComplete={() => void complete()}
        onBack={() => void back()}
        onSkip={() => void skip()}
      />
    );
  }

  if (page === "role") {
    const changePath = (path: OnboardingPath) => {
      void onboarding.setPath(
        path,
        path === "coach" ? (state.coachClientBand ?? "1_5") : null,
      );
    };
    const changeBand = (band: CoachClientBand) => {
      void onboarding.setPath("coach", band);
    };
    return (
      <OnboardingRolePresenter
        path={state.path}
        band={state.coachClientBand}
        onPathChange={changePath}
        onBandChange={changeBand}
        onBack={() => void back()}
        onContinue={() => void complete()}
        onSkip={() => void skip()}
      />
    );
  }

  if (page === "habits") {
    return (
      <HabitSetupContainer
        onboarding
        onComplete={() => void complete()}
        onBack={() => void back()}
        onSkip={() => void skip()}
      />
    );
  }

  if (page === "nutrition" || page === "train") {
    const kind = page === "nutrition" ? "nutrition" : "training";
    const options =
      kind === "nutrition"
        ? NUTRITION_ONBOARDING_OPTIONS
        : TRAINING_ONBOARDING_OPTIONS;
    const selected = state.intentKeys.find((intent) =>
      intent.startsWith(`${kind}_`),
    ) as OnboardingIntentKey | undefined;
    const value = selected ?? options[options.length - 1].intent;
    return (
      <OnboardingIntentPresenter
        kind={kind}
        value={value}
        onChange={(intent) => void onboarding.setIntentChoice(kind, intent)}
        onBack={() => void back()}
        onContinue={() => void complete()}
        onSkip={() => void skip()}
      />
    );
  }

  // The plan picker is the only page that genuinely cannot work offline:
  // plans and entitlements are both server-owned. Everything before it is
  // local-first and has already been saved. So rather than block the journey,
  // offer the two honest outcomes — finish now and pick a plan later, or
  // reconnect and retry.
  //
  // `isEntitled` is checked first below, but only ever true from a read that
  // succeeded; offline it is false because the data is absent, not free.
  if (!isEntitled && !isOnline) {
    const finishWithoutPlan = async () => {
      await onboarding.completePage("recommendation");
      await onboarding.completeJourney();
      router.replace("/(app)/(tabs)");
    };
    return (
      <OnboardingOfflinePlansPresenter
        onFinish={() => void finishWithoutPlan()}
        onRetry={() => void subscription.refetch()}
        onBack={() => void back()}
      />
    );
  }

  if (isEntitled) {
    const finishAccountOnlyJourney = async () => {
      await onboarding.completePage("recommendation");
      await onboarding.completeJourney();
      router.replace("/(app)/(tabs)");
    };
    return (
      <OnboardingAccountConfirmationPresenter
        tierDisplayName={subscription.data?.tierDisplayName ?? "Premium"}
        expiresAt={subscription.data?.expiresAt ?? null}
        onContinue={() => void finishAccountOnlyJourney()}
      />
    );
  }

  return (
    <SubscriptionSelectionContainer
      onboardingRecommendation={{
        recommendedTier: recommendation.tierName,
        reasons: recommendation.reasons,
        showOtherPlans: showOthers,
        onToggleOtherPlans: () => setShowOthers((visible) => !visible),
        onPlanSelected: (tier) =>
          onboarding.track("onboarding_plan_selected", {
            selectedTier: tier,
          }),
        onContinueFree: () => {
          void (async () => {
            await onboarding.completePage("recommendation");
            await onboarding.completeJourney();
            router.replace("/(app)/(tabs)");
          })();
        },
        onBack: () => void back(),
        onSkip: () => void skip(),
      }}
    />
  );
}
