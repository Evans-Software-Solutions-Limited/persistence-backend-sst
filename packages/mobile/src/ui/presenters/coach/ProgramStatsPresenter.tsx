import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconChevronR, IconLayers } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { CoachProgram } from "@/domain/models/coachOverview";

/**
 * <ProgramStatsPresenter> — Coach You "Programmes in use" section.
 * Ports the prototype's `ProgramStats` (design-source/screens/coach.jsx:
 * 226-253): a header ("Programmes in use" + "View all") over a Card list, one
 * row per programme with a trainer-dim layers tile, the name, "N client(s)
 * active", and a chevron.
 *
 * Empty programmes → a single placeholder row ("No active programmes yet").
 *
 * Exported separately so Coach Home can reuse it later.
 */

export type ProgramStatsPresenterProps = {
  programs: CoachProgram[];
  onViewAll?: () => void;
  testID?: string;
};

export function ProgramStatsPresenter({
  programs,
  onViewAll,
  testID,
}: ProgramStatsPresenterProps) {
  const trainerBase = toneHex("trainer").base;
  // Concrete hex for the chevron icon (SVG consumer — can't take a token).
  const text3 = color.$text3;

  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        paddingHorizontal={2}
        marginBottom={10}
      >
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={24}
          letterSpacing={-0.5}
          color="$text"
        >
          Programmes in use
        </Text>
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$primary"
          onPress={onViewAll}
        >
          View all
        </Text>
      </View>

      <Card pad={0} radius={14}>
        {programs.length === 0 ? (
          <View padding={14} testID="coach-programs-empty">
            <Text fontFamily="$body" fontSize={13} color="$text3">
              No active programmes yet
            </Text>
          </View>
        ) : (
          programs.map((p, i) => (
            <View
              key={p.id}
              flexDirection="row"
              alignItems="center"
              gap={12}
              padding={12}
              paddingHorizontal={14}
              borderTopWidth={i ? 1 : 0}
              borderColor="$border"
            >
              <View
                width={32}
                height={32}
                borderRadius={8}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$accentTrainerDim"
              >
                <IconLayers size={16} color={trainerBase} />
              </View>
              <View flex={1}>
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={15}
                  color="$text"
                >
                  {p.name}
                </Text>
                <Text fontFamily="$body" fontSize={11} color="$text3">
                  {p.activeClients} client{p.activeClients === 1 ? "" : "s"}{" "}
                  active
                </Text>
              </View>
              <IconChevronR size={14} color={text3} />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
