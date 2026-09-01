import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Alert } from "react-native";

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
import {
  NUTRITION_ONBOARDING_OPTIONS,
  OnboardingIntentPresenter,
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
  const [showOthers, setShowOthers] = useState(false);
  const viewedRef = useRef<OnboardingPage | null>(null);

  const state = onboarding.state;

  useEffect(() => {
    if (!state || onboarding.isLoading || state.status !== "in_progress")
      return;
    if (state.currentPage !== page) {
      router.replace(ONBOARDING_ROUTES[state.currentPage] as Href);
      return;
    }
    if (viewedRef.current !== page) {
      viewedRef.current = page;
      onboarding.track("onboarding_page_viewed", { page });
      if (page === "recommendation") {
        onboarding.track("onboarding_recommendation_viewed");
      }
    }
  }, [state, onboarding, page, router]);

  const goTo = (next: OnboardingPage | null) => {
    if (next) router.replace(ONBOARDING_ROUTES[next] as Href);
  };

  const complete = async () => goTo(await onboarding.completePage(page));
  const skip = async () => {
    const next = await onboarding.skipPage(page);
    if (next) goTo(next);
    else {
      await onboarding.completeJourney();
      router.replace("/(app)/(tabs)");
    }
  };
  const back = async () => {
    const previous = await onboarding.goBack();
    router.replace(ONBOARDING_ROUTES[previous] as Href);
  };

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

  if (onboarding.isLoading || !state || !recommendation) {
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
