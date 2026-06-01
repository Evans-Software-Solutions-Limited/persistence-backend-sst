import { useLocalSearchParams } from "expo-router";
import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Generic placeholder screen used by surfaces whose real UI hasn't
 * landed yet (M10 wires subscription, etc.). The `feature` query
 * param picks the copy.
 *
 * M3 update: the `active-session` entry was dropped after the four
 * callers (WorkoutsList, WorkoutDetail, Home Start CTA, popover) all
 * routed to `/(app)/session?workoutId=<id>`. The route remains for
 * other features that haven't shipped yet.
 */
export default function ComingSoonRoute() {
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const config = COPY[feature as keyof typeof COPY] ?? COPY.default;
  return (
    <ComingSoon
      icon={config.icon}
      title={config.title}
      description={config.description}
      testID="coming-soon"
    />
  );
}

const COPY = {
  "workout-creator": {
    icon: "add-circle-outline" as const,
    title: "Create Workout",
    description: "Workout creator follows in the next mobile PR.",
  },
  "workout-editor": {
    icon: "create-outline" as const,
    title: "Edit Workout",
    description: "Workout editor follows in the next mobile PR.",
  },
  "exercise-creator": {
    icon: "barbell-outline" as const,
    title: "Create Exercise",
    description:
      "Custom exercise creation from the workout picker arrives in milestone M5.",
  },
  subscription: {
    icon: "card-outline" as const,
    title: "Manage Subscription",
    description:
      "Subscription management moves into the profile drawer in an upcoming release.",
  },
  health: {
    icon: "heart-outline" as const,
    title: "Health & Integrations",
    description:
      "Health-app connections surface here once 07-health-integration ships its profile screen.",
  },
  achievements: {
    icon: "trophy-outline" as const,
    title: "Achievements",
    description:
      "Your achievements grid arrives with 06-progress-goals.",
  },
  notifications: {
    icon: "notifications-outline" as const,
    title: "Notifications",
    description:
      "Notification preferences arrive with 09-notifications-social.",
  },
  default: {
    icon: "construct-outline" as const,
    title: "Coming Soon",
    description: "This surface is on its way.",
  },
};
