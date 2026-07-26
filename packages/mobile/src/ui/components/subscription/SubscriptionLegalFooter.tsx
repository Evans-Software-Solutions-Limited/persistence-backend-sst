import React from "react";
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from "@/domain/models/legal";
import { color } from "@/ui/theme/tokens";

/**
 * Legal disclosure block rendered at the foot of every subscription purchase
 * surface.
 *
 * Apple App Review Guideline 3.1.2 requires that an auto-renewable
 * subscription's point of purchase discloses, *in the binary*, the renewal
 * mechanics plus **functional** links to the Terms of Use (EULA) and the
 * privacy policy. The plan tiles above already carry title / length / price
 * per period; this block supplies the remaining two requirements.
 *
 * Rendered by both purchase rails so the two stay in lockstep:
 *   - `IOSPurchaseFlowPresenter` (Apple IAP via RevenueCat) — `rail="apple"`
 *   - `SubscriptionSelectionPresenter` (Stripe rail) — `rail="card"`
 *
 * The disclosure text is rail-aware because the billing relationship differs:
 * the Apple rail charges an Apple Account and is managed in Apple Account
 * settings, the card rail charges a card and is managed in-app. Apple only
 * ever sees the `apple` variant (the Stripe rail is unreachable on iOS —
 * `SubscriptionSelectionContainer` dispatches to the IAP flow), but shipping
 * "charged to your Apple Account" on a card-billed Android surface would be
 * plainly untrue, so the wording follows the rail rather than the guideline.
 *
 * Links open in the system browser. A `Linking` rejection is swallowed — a
 * dead browser handoff must never wedge the purchase flow — matching the
 * established pattern in `DataSharingConsentSheet`.
 *
 * @see https://developer.apple.com/app-store/review/guidelines/#3.1.2
 */
export type SubscriptionLegalFooterProps = {
  /** Which billing rail this surface uses. Defaults to Apple IAP. */
  rail?: "apple" | "card";
};

const DISCLOSURE: Record<"apple" | "card", string> = {
  apple:
    "Payment is charged to your Apple Account at confirmation of purchase. " +
    "Subscriptions renew automatically for the same period and price unless " +
    "auto-renew is turned off at least 24 hours before the end of the current " +
    "period. Manage or cancel your subscription in your Apple Account settings.",
  card:
    "Payment is charged to your payment method at confirmation of purchase. " +
    "Subscriptions renew automatically for the same period and price unless " +
    "auto-renew is turned off at least 24 hours before the end of the current " +
    "period. Manage or cancel your subscription from this screen at any time.",
};

export function SubscriptionLegalFooter({
  rail = "apple",
}: SubscriptionLegalFooterProps = {}) {
  const open = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.container} testID="subscription-legal-footer">
      <Text style={styles.disclosure} testID="subscription-legal-disclosure">
        {DISCLOSURE[rail]}
      </Text>

      <View style={styles.linkRow}>
        <TouchableOpacity
          onPress={() => open(TERMS_OF_USE_URL)}
          testID="subscription-terms-link"
          accessibilityRole="link"
          accessibilityLabel="Terms of Use, opens in browser"
        >
          <Text style={styles.link}>Terms of Use (EULA)</Text>
        </TouchableOpacity>

        <Text style={styles.separator}>·</Text>

        <TouchableOpacity
          onPress={() => open(PRIVACY_POLICY_URL)}
          testID="subscription-privacy-link"
          accessibilityRole="link"
          accessibilityLabel="Privacy Policy, opens in browser"
        >
          <Text style={styles.link}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    marginBottom: 32,
    gap: 12,
  },
  disclosure: {
    fontSize: 11,
    lineHeight: 16,
    color: color.$text2,
    textAlign: "center",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  link: {
    fontSize: 12,
    fontWeight: "600",
    color: color.$primary,
  },
  separator: {
    fontSize: 12,
    color: color.$text2,
  },
});
