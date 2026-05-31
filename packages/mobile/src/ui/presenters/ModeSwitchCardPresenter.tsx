import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation";
import { IconSwap, IconUsers, iconDefaults } from "@/ui/components/icons";
import { toneHex } from "@/ui/components/foundation/tones";

/**
 * <ModeSwitchCardPresenter> — the athlete↔coach mode-switch card inside the
 * ProfileDrawer. Pure presenter; the container wires `onSwitch` to
 * `useModeSwitch().switchMode` (which owns close→switch→tab-remap).
 *
 * Spec: specs/08-profile-settings/design.md § <ModeSwitchCardPresenter>
 *       specs/08-profile-settings/requirements.md STORY-003 (AC 3.1–3.5)
 * Source: extra.jsx:44–69.
 *
 * Renders ONLY when the user is trainer-eligible — that gate lives in the
 * parent (ProfileDrawerPresenter), per STORY-003 AC 3.1.
 *
 * Background gradients shift by mode (AC 3.2): athlete → $surface2 + $border;
 * coach → trainer-dim tinted bg + trainer-dim border. (We approximate the
 * prototype's 135deg linear-gradient with a flat $accentTrainerDim fill —
 * RN has no first-class CSS gradient on a plain View and the dim tone reads
 * the same on the dark surface.)
 */

export type ModeSwitchCardProps = {
  mode: "athlete" | "coach";
  clientCount?: number;
  onSwitch: (next: "athlete" | "coach") => void | Promise<void>;
  testID?: string;
};

export function ModeSwitchCardPresenter({
  mode,
  clientCount,
  onSwitch,
  testID,
}: ModeSwitchCardProps) {
  const isCoach = mode === "coach";

  // Coach title: "Coaching {N} clients" when count known, else the
  // count-free "your clients" copy (STORY-003 AC 3.6 — useTrainerClients
  // not shipped until M8).
  const title = isCoach
    ? clientCount != null
      ? `Coaching ${clientCount} clients`
      : "Coaching your clients"
    : "Trainer Mode";

  const sub = isCoach
    ? "Athletes feel like normal users"
    : "Switch to manage your clients";

  // Tap target = the OTHER mode.
  const next: "athlete" | "coach" = isCoach ? "athlete" : "coach";

  return (
    <View
      testID={testID}
      marginBottom={14}
      padding={14}
      borderRadius={14}
      borderWidth={1}
      backgroundColor={isCoach ? "$accentTrainerDim" : "$surface2"}
      borderColor={isCoach ? "$accentTrainerDim" : "$border"}
    >
      <View flexDirection="row" alignItems="center" gap={12}>
        <View
          width={38}
          height={38}
          borderRadius={10}
          backgroundColor="$accentTrainerDim"
          alignItems="center"
          justifyContent="center"
        >
          <IconUsers
            {...iconDefaults({ size: 20 })}
            color={toneHex("trainer").base}
          />
        </View>

        <View flex={1}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            letterSpacing={-0.3}
            color="$text"
          >
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={11.5} color="$text3">
            {sub}
          </Text>
        </View>

        <Btn
          variant={isCoach ? "soft" : "filled"}
          tone="trainer"
          size="sm"
          icon={
            isCoach ? (
              <IconSwap
                {...iconDefaults({ size: 14 })}
                color={toneHex("trainer").base}
              />
            ) : undefined
          }
          onPress={() => onSwitch(next)}
          accessibilityLabel={
            isCoach ? "Switch to athlete mode" : "Switch to coach mode"
          }
          testID={testID ? `${testID}-cta` : undefined}
        >
          {isCoach ? "Athlete" : "Switch"}
        </Btn>
      </View>
    </View>
  );
}
