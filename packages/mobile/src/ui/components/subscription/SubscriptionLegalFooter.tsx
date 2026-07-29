import React from "react";
import {
  Linking,
  Platform,
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
 *   - `IOSPurchaseFlowPresenter` (Apple IAP via RevenueCat) — `rail="store"`
 *   - `SubscriptionSelectionPresenter` (non-iOS catalogue) — `rail="store"`
 *
 * The disclosure text is rail-aware because the billing relationship differs
 * per store, and naming the wrong one is both untrue and a review risk:
 *
 *   - `rail="store"` (default) — platform IAP. Resolves to **Apple Account**
 *     on iOS and **Google Play account** on Android, so the same component
 *     serves a future Play submission without a call-site change. Google Play
 *     policy requires the equivalent disclosure, and naming Apple on Android
 *     would fail it.
 *   - `rail="card"` — a rail that charges a payment method directly and is
 *     managed in-app. **No surface uses this today**: the Stripe Apple Pay rail
 *     was removed under App Review Guideline 2.1. Kept for a future non-store
 *     rail (Android/web); do not point an iOS surface at it (§3.1.1).
 *
 * Links open in the system browser. A `Linking` rejection is swallowed — a
 * dead browser handoff must never wedge the purchase flow — matching the
 * established pattern in `DataSharingConsentSheet`.
 *
 * @see https://developer.apple.com/app-store/review/guidelines/#3.1.2
 */
export type SubscriptionLegalFooterProps = {
  /** Which billing rail this surface uses. Defaults to platform IAP. */
  rail?: "store" | "card";
};

/**
 * The renewal mechanics are identical across rails and are what Apple 3.1.2
 * and Google Play's subscription policy both require; only the account being
 * charged and the place you manage it differ.
 */
const RENEWAL_TERMS =
  "Subscriptions renew automatically for the same period and price unless " +
  "auto-renew is turned off at least 24 hours before the end of the current " +
  "period.";

function disclosureFor(rail: "store" | "card"): string {
  if (rail === "card") {
    return (
      `Payment is charged to your payment method at confirmation of purchase. ` +
      `${RENEWAL_TERMS} Manage or cancel your subscription from this screen at ` +
      `any time.`
    );
  }
  const account = Platform.OS === "android" ? "Google Play" : "Apple";
  const settings =
    Platform.OS === "android"
      ? "Google Play subscription settings"
      : "Apple Account settings";
  return (
    `Payment is charged to your ${account} account at confirmation of ` +
    `purchase. ${RENEWAL_TERMS} Manage or cancel your subscription in your ` +
    `${settings}.`
  );
}

export function SubscriptionLegalFooter({
  rail = "store",
}: SubscriptionLegalFooterProps = {}) {
  const open = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.container} testID="subscription-legal-footer">
      <Text style={styles.disclosure} testID="subscription-legal-disclosure">
        {disclosureFor(rail)}
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
