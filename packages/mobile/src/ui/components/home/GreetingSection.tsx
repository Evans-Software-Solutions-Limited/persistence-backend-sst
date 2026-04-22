import { Column } from "@/ui/components/Column";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";
import {
  SubscriptionBadge,
  type SubscriptionBadgeProps,
} from "./SubscriptionBadge";

/**
 * Top-of-home greeting + subscription badge. Ported 1:1 from
 * `persistence-mobile/components/home/GreetingSection/GreetingSection.tsx`.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.1, 5.6
 */

export type GreetingSectionProps = {
  /**
   * First name for the greeting. Falls back to "Lifter" when null per
   * AC 5.1.
   */
  firstName: string | null;
  subscription: Omit<
    SubscriptionBadgeProps,
    "onUpgradePress" | "onManagePress"
  >;
  onUpgradePress: () => void;
  onManagePress?: () => void;
};

export function GreetingSection({
  firstName,
  subscription,
  onUpgradePress,
  onManagePress,
}: GreetingSectionProps) {
  const displayName =
    firstName && firstName.trim().length > 0 ? firstName : "Lifter";
  return (
    <Column gap="sm" testID="greeting-section">
      <Row justify="between" gap="sm">
        <Column gap="xs">
          <Text variant="label" secondary>
            WELCOME BACK
          </Text>
          <Text variant="h2">Hey, {displayName}</Text>
        </Column>
      </Row>
      <SubscriptionBadge
        {...subscription}
        onUpgradePress={onUpgradePress}
        onManagePress={onManagePress}
      />
    </Column>
  );
}
