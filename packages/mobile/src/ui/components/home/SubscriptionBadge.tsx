import { Pressable } from "react-native";
import { Badge } from "@/ui/components/Badge";
import { Button } from "@/ui/components/Button";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";

/**
 * Subscription tier badge with an optional "Upgrade" CTA for free-tier
 * users. Ported 1:1 from `persistence-mobile/components/home/GreetingSection/`
 * (legacy inlined this logic; V2 splits it out for testability).
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.6
 */

export type SubscriptionBadgeProps = {
  tierName: string | null;
  isFreeTier: boolean;
  isTrainerTier: boolean;
  onUpgradePress: () => void;
  onManagePress?: () => void;
};

function labelFor(
  tierName: string | null,
  isFreeTier: boolean,
  isTrainerTier: boolean,
): string {
  if (isTrainerTier) return "Trainer";
  if (isFreeTier) return "Free";
  return tierName ?? "Member";
}

export function SubscriptionBadge({
  tierName,
  isFreeTier,
  isTrainerTier,
  onUpgradePress,
  onManagePress,
}: SubscriptionBadgeProps) {
  const label = labelFor(tierName, isFreeTier, isTrainerTier);
  const variant: "primary" | "success" | "warning" = isTrainerTier
    ? "success"
    : isFreeTier
      ? "warning"
      : "primary";

  return (
    <Row gap="sm" testID="subscription-badge">
      {onManagePress ? (
        <Pressable onPress={onManagePress} testID="subscription-manage">
          <Badge label={label} variant={variant} size="md" />
        </Pressable>
      ) : (
        <Badge label={label} variant={variant} size="md" />
      )}
      {isFreeTier ? (
        <Button
          label="Upgrade"
          onPress={onUpgradePress}
          variant="secondary"
          size="sm"
          testID="subscription-upgrade"
        />
      ) : (
        <Text variant="caption" muted>
          {onManagePress ? "Manage plan" : null}
        </Text>
      )}
    </Row>
  );
}
