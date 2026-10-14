import { Text, View, useTheme } from "@tamagui/core";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";
import { Card } from "@/ui/components/foundation/Card";
import { IconLock, IconUsers } from "@/ui/components/icons";

/** Claude v2 VisRow geometry, with the approved bounded local audiences. Open is nearby-only. */
export function TogetherAudienceOptions({
  audience,
  onAudienceChange,
  trainingPartners,
}: {
  trainingPartners?: { selected: boolean; onSelect(): void };
  audience: TogetherLobbyAudience;
  onAudienceChange(value: TogetherLobbyAudience): void;
}) {
  // Both app themes define text3 in ui/theme/themes.ts.
  const theme = useTheme();
  return (
    <View
      gap={9}
      accessibilityRole="radiogroup"
      accessibilityLabel="Who can join?"
    >
      {(
        [
          ["invite-only", "Private", "Code or QR only", IconLock],
          ...(trainingPartners
            ? [
                [
                  "friends",
                  "Training partners",
                  "Train with your accepted training partners",
                  IconUsers,
                ] as const,
              ]
            : []),
          ["open", "Open nearby", "Athletes nearby can find it", IconUsers],
        ] as const
      ).map(([value, title, detail, Icon]) => {
        const selected =
          value === "friends"
            ? trainingPartners?.selected
            : !trainingPartners?.selected && audience === value;
        return (
          <Card
            key={value}
            surface={1}
            pad={13}
            radius={12}
            onPress={() =>
              value === "friends"
                ? trainingPartners?.onSelect()
                : onAudienceChange(value)
            }
            accessibilityRole="radio"
            accessibilityLabel={title}
            accessibilityState={{ checked: selected }}
            accent={selected ? "primary" : undefined}
          >
            <View flexDirection="row" alignItems="center" gap={11}>
              <View
                width={16}
                height={16}
                borderRadius={8}
                borderWidth={1.5}
                borderColor={selected ? "$primary" : "$border3"}
                alignItems="center"
                justifyContent="center"
              >
                {selected && (
                  <View
                    width={8}
                    height={8}
                    borderRadius={4}
                    backgroundColor="$primary"
                  />
                )}
              </View>
              <Icon
                size={16}
                color={selected ? theme.primary.val : theme.text3!.val}
              />
              <View flex={1}>
                <Text
                  fontFamily="$display"
                  fontSize={14}
                  lineHeight={18}
                  fontWeight="600"
                  color="$text"
                >
                  {title}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={11.5}
                  lineHeight={15}
                  color="$text3"
                  marginTop={2}
                >
                  {detail}
                </Text>
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}
