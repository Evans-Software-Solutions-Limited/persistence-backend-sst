import { useLocalSearchParams } from "expo-router";
import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Generic placeholder screen used by surfaces whose real UI hasn't
 * landed yet (M2 mobile follow-up wires creator + editor; M3 wires
 * active-session; M10 wires subscription). The `feature` query param
 * picks the copy.
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
  "active-session": {
    icon: "play-circle-outline" as const,
    title: "Active Session",
    description: "Live workout tracking arrives in milestone M3.",
  },
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
  subscription: {
    icon: "lock-closed-outline" as const,
    title: "Upgrade Subscription",
    description: "Tier selection + Stripe checkout arrive in milestone M10.",
  },
  default: {
    icon: "construct-outline" as const,
    title: "Coming Soon",
    description: "This surface is on its way.",
  },
};
