import { SUBSCRIPTION_CATALOG } from "@persistence/subscription-catalog";
import type { MySubscription } from "@/domain/models/subscription";

export interface OnboardingBenefit {
  title: string;
  description: string;
}

/** Describe current access, including server-owned limits, without selling a plan. */
export function getOnboardingBenefits(
  subscription: MySubscription,
): OnboardingBenefit[] {
  const benefits: OnboardingBenefit[] = [
    {
      title:
        subscription.workoutLimit === null
          ? "Unlimited workouts"
          : "Your workout plans",
      description:
        subscription.workoutLimit === null
          ? "Build your workouts, log every set and look back at your training history."
          : `Create up to ${subscription.workoutLimit} custom workouts and log your sets.`,
    },
    {
      title: "Food and progress, together",
      description:
        "Track calories, scan barcodes and follow your streaks and personal records.",
    },
  ];
  if (subscription.aiAccess) {
    benefits.push({
      title: "Easier food logging",
      description:
        "Estimate nutrition from a photo or a description, then review it before saving.",
    });
  }
  if (
    SUBSCRIPTION_CATALOG.find((tier) => tier.id === subscription.tierName)
      ?.suite
  ) {
    benefits.push(
      {
        title: "Loadout",
        description: "Adapt workouts to the equipment available in your gym.",
      },
      {
        title: "Mealprint",
        description:
          "Get meal suggestions and lighter swaps around your calorie targets and preferences.",
      },
    );
  }
  if (subscription.isTrainerTier) {
    benefits.push({
      title: "Your coaching tools",
      description:
        subscription.trainerClientLimit === null
          ? "Build programmes, assign workouts and follow progress for unlimited clients."
          : `Build programmes, assign workouts and follow progress for up to ${subscription.trainerClientLimit} clients.`,
    });
    if (subscription.aiAccess) {
      benefits.push({
        title: "Client insights",
        description:
          "Review AI weekly summaries of your clients' training and habits.",
      });
    }
  }
  return benefits;
}
