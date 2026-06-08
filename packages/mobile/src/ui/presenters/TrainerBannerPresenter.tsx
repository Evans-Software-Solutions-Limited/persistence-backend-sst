/**
 * <TrainerBannerPresenter> — coach on-behalf banner on the active session.
 *
 * Ports `~/Downloads/handoff/design-source/screens/active-workout.jsx:45–63`.
 * A trainer-accent gradient strip: a 28pt trainer Avatar, an eyebrow + client
 * name, and a LIVE (success) or RETRO (neutral) Pill.
 *
 * Pure visual SLOT — shipped here, data wired by M8 (`10-trainer-features`).
 * `ActiveSessionPresenter` renders it only when `withClient !== undefined`
 * (STORY-004 AC 4.6); athletes never see it.
 *
 * Notes vs prototype:
 *  - The `<Pill>` primitive renders text-only children, so the LIVE "glow dot"
 *    sits just left of the pill (a Row) rather than inside it; the dot is a
 *    static `$success` glow per the prototype (the pulsing dot is the minimised
 *    bar's, not this pill's).
 *
 * Spec: specs/05-active-session/design.md § <TrainerBannerPresenter>
 *       specs/05-active-session/requirements.md STORY-004 (AC 4.2–4.5)
 */

import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { Avatar } from "@/ui/components/foundation/Avatar";
import { Pill } from "@/ui/components/foundation/Pill";
import { color } from "@/ui/theme/tokens";

export type TrainerBannerPresenterProps = {
  withClient: { initials: string; name: string };
  /** true = retroactive log (RETRO); false/undefined = live session (LIVE). */
  retroactive?: boolean;
  testID?: string;
};

export function TrainerBannerPresenter({
  withClient,
  retroactive,
  testID = "trainer-banner",
}: TrainerBannerPresenterProps) {
  return (
    <LinearGradient
      colors={[color.$accentTrainerDim, color.$surface2]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
      testID={testID}
    >
      <Avatar initials={withClient.initials} size={28} tone="trainer" />

      <View flex={1}>
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={9}
          letterSpacing={0.5}
          textTransform="uppercase"
          color="$accentTrainer"
          testID={`${testID}-eyebrow`}
        >
          {retroactive ? "LOGGING SESSION FOR" : "TRAINING LIVE WITH"}
        </Text>
        <Text color="$text" fontSize={13} fontWeight="600" marginTop={1}>
          {withClient.name}
        </Text>
      </View>

      {retroactive ? (
        <Pill tone="neutral" size="xs" testID={`${testID}-pill-retro`}>
          RETRO
        </Pill>
      ) : (
        <View flexDirection="row" alignItems="center" gap={4}>
          <View style={styles.liveDot} testID={`${testID}-live-dot`} />
          <Pill tone="success" size="xs" testID={`${testID}-pill-live`}>
            LIVE
          </Pill>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.$accentTrainerDim,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  liveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.$success,
    shadowColor: color.$success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 2,
  },
});
