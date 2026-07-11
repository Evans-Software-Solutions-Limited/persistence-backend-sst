import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconChevronR, IconLayers, iconDefaults } from "@/ui/components/icons";

/**
 * <ProgrammeAlertsPresenter> — Coach Home "Programme alerts" block. Ports the
 * prototype `CoachHome` programme-alerts section (design-source/screens/
 * coach-home.jsx:108-125) 1:1: a "PROGRAMME ALERTS" eyebrow over a Card of
 * rows (tone-tinted IconLayers tile + client name + "‹programme› ends in N
 * weeks" text + chevron), each tapping through to Client Detail.
 *
 * Pure presentational. The container derives the alerts from the roster
 * (`programEndDate` within the alert window) — see `buildProgrammeAlerts` in
 * CoachHomeContainer. Renders NOTHING when there are no alerts (the whole
 * section is hidden, per the brief), so it is safe to always mount.
 */

export type ProgrammeAlertVM = {
  clientId: string;
  client: string;
  /** e.g. "Strength Foundations ends in 2 weeks". */
  text: string;
  /** Urgency tone: `ember` within ~1 week, else `trainer`. */
  tone: "trainer" | "ember";
};

export type ProgrammeAlertsPresenterProps = {
  alerts: ProgrammeAlertVM[];
  onOpenClient: (clientId: string) => void;
  testID?: string;
};

export function ProgrammeAlertsPresenter({
  alerts,
  onOpenClient,
  testID,
}: ProgrammeAlertsPresenterProps) {
  if (alerts.length === 0) return null;

  return (
    <View testID={testID}>
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
        marginBottom={8}
      >
        Programme alerts
      </Text>
      <Card pad={0} radius={14}>
        {alerts.map((a, i) => {
          const hex = toneHex(a.tone);
          return (
            <Pressable
              key={a.clientId}
              onPress={() => onOpenClient(a.clientId)}
              accessibilityRole="button"
              accessibilityLabel={`${a.client}: ${a.text}`}
              testID={`coach-home-alert-${a.clientId}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={10}
                paddingVertical={11}
                paddingHorizontal={14}
                borderTopWidth={i === 0 ? 0 : 1}
                borderColor="$border"
                minHeight={44}
              >
                <View
                  width={28}
                  height={28}
                  borderRadius={8}
                  backgroundColor={hex.dim}
                  alignItems="center"
                  justifyContent="center"
                >
                  <IconLayers
                    {...iconDefaults({ size: 14 })}
                    color={hex.base}
                  />
                </View>
                <View flex={1} minWidth={0}>
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={15}
                    color="$text"
                    numberOfLines={1}
                  >
                    {a.client}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={11}
                    color="$text3"
                    numberOfLines={1}
                  >
                    {a.text}
                  </Text>
                </View>
                <IconChevronR {...iconDefaults({ size: 14 })} color="#8A8A98" />
              </View>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}
