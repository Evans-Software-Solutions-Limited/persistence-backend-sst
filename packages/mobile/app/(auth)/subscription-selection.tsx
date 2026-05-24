import { SubscriptionSelectionContainer } from "@/ui/containers/SubscriptionSelectionContainer";

/**
 * Expo Router thin wrapper for the Subscription Selection screen.
 * Container owns all logic + state + side effects.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 1.9
 */
export default function SubscriptionSelectionScreen() {
  return <SubscriptionSelectionContainer />;
}
