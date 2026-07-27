import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LoadoutScaffold } from "./LoadoutScaffold";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutAdaptingStep> — the skeleton shown while the preview is in flight
 * (T-2.5, design D7 step 5), and the error surfaces that replace it.
 *
 * ## ⚠ This step is bound to the REQUEST. It must never be bound to a timer.
 *
 * The prototype auto-advances after 1700 ms. Shipping that would be a bug with
 * two faces: E2 measured the re-map at 2.6 s p50 / 3.8 s max and
 * `createWithRetry` can spend up to 24 s on the retry path, so a timer either
 * cuts the request off visually while it is still running, or — worse — shows a
 * review screen with no rows in it. The store only leaves this step via
 * `previewResolved`.
 *
 * ## ⚠ The failure copy, and the one sentence that must not appear
 *
 * `503` means Bedrock is down and there is **no cheaper fallback** — a model
 * failure is deliberately never downgraded to the § 6.2 ranker, because
 * ranker-only output is what the bake-off rejected 4-50. So the honest answer is
 * "unavailable, use the picker", and the picker genuinely is the floor here
 * (AC-2.1/2.2), not a consolation prize.
 *
 * **Never "try rephrasing".** There is no prompt to rephrase — that copy is the
 * existing mistake at `QuickAddSheetContainer.tsx:267` and
 * `SnapAISheetContainer.tsx:100`, where every non-429 error collapses into
 * advice the user cannot act on.
 */

export type LoadoutAdaptingError =
  /** 402 — not entitled. Should be unreachable behind the gate; handled anyway. */
  | "entitlement"
  /** 429 — the daily re-map ceiling. */
  | "limit"
  /** 503 — Bedrock unavailable. No fallback exists (design § 6.0). */
  | "unavailable"
  /** Anything else, including offline. */
  | "generic";

export type LoadoutAdaptingStepProps = {
  readonly workoutName: string;
  readonly gymLabel: string;
  readonly error: LoadoutAdaptingError | null;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  /** Route to the manual picker — the always-available path. */
  readonly onPickManually: () => void;
  readonly onUpgrade: () => void;
};

const SKELETON_ROWS = [0, 1, 2, 3, 4] as const;

type ErrorCopy = {
  readonly title: string;
  readonly body: string;
  /** Retrying a ceiling or an entitlement denial cannot succeed — don't offer it. */
  readonly retryable: boolean;
  readonly upgrade: boolean;
};

export function adaptingErrorCopy(error: LoadoutAdaptingError): ErrorCopy {
  switch (error) {
    case "entitlement":
      return {
        title: "Loadout is a Premium+ feature",
        body: "Upgrade to adapt your workouts to any gym.",
        retryable: false,
        upgrade: true,
      };
    case "limit":
      return {
        title: "That's your adaptations for today",
        body: "You've used today's limit — it resets tomorrow. You can still pick your kit and swap exercises by hand.",
        retryable: false,
        upgrade: false,
      };
    case "unavailable":
      return {
        // Named plainly. The alternative — a generic "something went wrong" — sends
        // the user back to retry a call that is going to fail for as long as the
        // outage lasts.
        title: "Loadout can't adapt right now",
        body: "The adaptation service is unavailable. Pick your equipment and swap what you need by hand — your workout still works.",
        retryable: true,
        upgrade: false,
      };
    case "generic":
      return {
        title: "Couldn't adapt this workout",
        body: "Check your connection and try again, or pick your equipment and swap by hand.",
        retryable: true,
        upgrade: false,
      };
  }
}

export function LoadoutAdaptingStep({
  workoutName,
  gymLabel,
  error,
  onBack,
  onRetry,
  onPickManually,
  onUpgrade,
}: LoadoutAdaptingStepProps) {
  if (error !== null) {
    const copy = adaptingErrorCopy(error);
    return (
      <LoadoutScaffold
        title="Loadout"
        onBack={onBack}
        testID="loadout-adapting-error"
      >
        <View style={styles.errorBlock}>
          <View style={styles.errorIcon}>
            <Ionicons
              name={error === "limit" ? "time-outline" : "alert-circle-outline"}
              size={26}
              color={error === "limit" ? color.$gold : color.$warning}
            />
          </View>
          <Text style={styles.errorTitle}>{copy.title}</Text>
          <Text style={styles.errorBody}>{copy.body}</Text>

          {copy.upgrade ? (
            <TouchableOpacity
              style={styles.primaryCta}
              onPress={onUpgrade}
              testID="loadout-adapting-upgrade"
              accessibilityRole="button"
            >
              <Text style={styles.primaryCtaText}>See Premium+</Text>
            </TouchableOpacity>
          ) : null}

          {copy.retryable ? (
            <TouchableOpacity
              style={styles.primaryCta}
              onPress={onRetry}
              testID="loadout-adapting-retry"
              accessibilityRole="button"
            >
              <Text style={styles.primaryCtaText}>Try again</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.secondaryCta}
            onPress={onPickManually}
            testID="loadout-adapting-manual"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryCtaText}>Pick equipment instead</Text>
          </TouchableOpacity>
        </View>
      </LoadoutScaffold>
    );
  }

  return (
    <LoadoutScaffold
      title="Adapting…"
      onBack={onBack}
      testID="loadout-adapting"
    >
      <View style={styles.statusRow}>
        <ActivityIndicator color={color.$primary} />
        <Text style={styles.statusText}>
          Re-mapping <Text style={styles.statusStrong}>{workoutName}</Text> to{" "}
          <Text style={styles.statusAccent}>{gymLabel}</Text>…
        </Text>
      </View>

      {SKELETON_ROWS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonBody}>
            <View
              style={[styles.skeletonLine, { width: `${58 + row * 8}%` }]}
            />
            <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
          </View>
        </View>
      ))}
    </LoadoutScaffold>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.$sm },
  statusText: { flex: 1, fontSize: 13, color: color.$text2, lineHeight: 19 },
  statusStrong: { color: color.$text, fontWeight: "700" },
  statusAccent: { color: color.$primary, fontWeight: "700" },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
  },
  skeletonIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.$md,
    backgroundColor: color.$surface3,
  },
  skeletonBody: { flex: 1, gap: space.$sm },
  skeletonLine: {
    height: 12,
    borderRadius: 5,
    backgroundColor: color.$surface3,
  },
  skeletonLineShort: { width: "42%", height: 10 },
  errorBlock: {
    alignItems: "center",
    gap: space.$md,
    paddingTop: space.$2xl,
    paddingHorizontal: space.$sm,
  },
  errorIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  errorBody: {
    fontSize: 13.5,
    color: color.$text2,
    lineHeight: 20,
    textAlign: "center",
  },
  primaryCta: {
    alignSelf: "stretch",
    height: 50,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.$sm,
  },
  primaryCtaText: { fontSize: 15, fontWeight: "700", color: color.$primaryInk },
  secondaryCta: {
    alignSelf: "stretch",
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryCtaText: { fontSize: 14, fontWeight: "600", color: color.$text2 },
});
