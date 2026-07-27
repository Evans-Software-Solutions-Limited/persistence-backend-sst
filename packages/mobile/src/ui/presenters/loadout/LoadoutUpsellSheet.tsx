import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BottomSheet } from "@/ui/components/foundation";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutUpsellSheet> — the Premium+ conversion surface behind a locked entry
 * point (T-2.2, design § 5.2 / D7's upsell).
 *
 * ## ⚠ There is no taster, and that shapes this screen
 *
 * design § 5.2 is a hard gate: no free-tier code path, no lifetime pool, no
 * `ai_taster` feature. **The handoff's `TasterMeterChip` and its "you've used all
 * 3 free scans" framing must not be built** — comping is a RevenueCat promotional
 * entitlement, which arrives through the normal webhook path and needs no
 * Loadout-side code. So this sheet is not "you ran out"; it is the only pitch the
 * feature ever gets, and it has to stand on the benefits alone.
 *
 * ## ⚠ The price comes from the catalog, and null is the EXPECTED value today
 *
 * `premium_plus` ships `is_active = false` (design § 9.1 — an active row
 * publishes a buyable card for a feature that does not exist), and the catalog
 * endpoint only returns active rows. So `priceMonthly` is null until the launch
 * build flips the flag, and the copy has to read correctly without it. It must
 * never fall back to a literal: the prototype's `£19.99` is retired and the real
 * figure is £29.99, which is precisely the drift a hardcoded number produces.
 */

export type LoadoutUpsellSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** From the catalog, or from a 402's `entitlement.upgradePriceMonthly`. Null → omitted. */
  readonly priceMonthly: number | null;
  readonly onUpgrade: () => void;
};

const BENEFITS: readonly string[] = [
  "Scan a gym or tick off the kit you can see",
  "Every exercise re-mapped to what's actually there",
  "Save gyms once and reuse them anywhere",
  "A reason for every swap — same targets, matched movements",
];

/** GBP, 2dp only when the price is not a whole number — matches the paywall. */
export function formatMonthlyPrice(price: number): string {
  const pounds = Number.isInteger(price) ? `${price}` : price.toFixed(2);
  return `£${pounds}`;
}

export function LoadoutUpsellSheet({
  visible,
  onClose,
  priceMonthly,
  onUpgrade,
}: LoadoutUpsellSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Unlock Loadout"
      eyebrow="PREMIUM+"
      accent="primary"
      height="peek"
      testID="loadout-upsell-sheet"
    >
      <View style={styles.body}>
        <View style={styles.headRow}>
          <View style={styles.icon}>
            <Ionicons name="sparkles" size={20} color={color.$primary} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.headTitle}>Any gym. Any kit.</Text>
            <Text style={styles.headSub}>
              Adapt any workout to what&apos;s in front of you
            </Text>
          </View>
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <Ionicons name="checkmark" size={16} color={color.$primary} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        {priceMonthly !== null ? (
          <View style={styles.priceRow} testID="loadout-upsell-price">
            <Text style={styles.priceValue}>
              {formatMonthlyPrice(priceMonthly)}
            </Text>
            <Text style={styles.priceUnit}>/mo · Premium+</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.cta}
          onPress={onUpgrade}
          testID="loadout-upsell-upgrade"
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>See Premium+</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.$lg,
    paddingBottom: space.$xl,
    gap: space.$base,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.$md },
  icon: {
    width: 46,
    height: 46,
    borderRadius: radius.$lg,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1, gap: 2 },
  headTitle: { fontSize: 18, fontWeight: "700", color: color.$text },
  headSub: { fontSize: 12.5, color: color.$text3, lineHeight: 18 },
  benefits: { gap: space.$md },
  benefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.$sm,
  },
  benefitText: { flex: 1, fontSize: 13.5, color: color.$text2, lineHeight: 19 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: space.$xs },
  priceValue: { fontSize: 24, fontWeight: "700", color: color.$text },
  priceUnit: { fontSize: 13, color: color.$text3 },
  cta: {
    height: 52,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 15, fontWeight: "700", color: color.$primaryInk },
});
