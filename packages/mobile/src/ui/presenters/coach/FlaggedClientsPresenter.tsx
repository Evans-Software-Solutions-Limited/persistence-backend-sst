import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Avatar, Card } from "@/ui/components/foundation";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import { IconChevronR, iconDefaults } from "@/ui/components/icons";

/**
 * <FlaggedClientsPresenter> — Coach Home "Needs you today" block. Ports the
 * prototype `CoachHome` flagged-clients section (design-source/screens/
 * coach-home.jsx:81-106) 1:1: a "NEEDS YOU TODAY" eyebrow + "N flagged" count +
 * "All clients →" link, over a Card of tappable client rows (trainer/gold
 * Avatar + name + tone-tinted subtitle + chevron).
 *
 * Pure presentational. The container derives the flagged list from the roster
 * (band atRisk/crisis or any flag) — see `buildFlaggedClients` in
 * CoachHomeContainer. Empty (0 flagged) → a calm "all on track" card.
 */

export type FlaggedClientVM = {
  clientId: string;
  name: string;
  initials: string;
  /** e.g. "4d IDLE · Cut wk 6" — composed from flags + programLabel. */
  sub: string;
  /** Drives the subtitle text colour (flag/band tone). */
  tone: Tone;
};

export type FlaggedClientsPresenterProps = {
  clients: FlaggedClientVM[];
  onOpenClient: (clientId: string) => void;
  onOpenClients: () => void;
  testID?: string;
};

/** Avatar tone is limited to primary|gold|trainer, so any non-trainer flag
 *  tone (error/ember/gold) maps onto gold — mirrors the prototype's
 *  `tone === 'error' ? 'gold' : tone` ring rule in an RN-safe way. */
function avatarTone(tone: Tone): "gold" | "trainer" {
  return tone === "trainer" ? "trainer" : "gold";
}

export function FlaggedClientsPresenter({
  clients,
  onOpenClient,
  onOpenClients,
  testID,
}: FlaggedClientsPresenterProps) {
  const count = clients.length;

  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        paddingHorizontal={2}
        marginBottom={10}
      >
        <View>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={4}
          >
            Needs you today
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={22}
            color="$text"
          >
            {count === 0 ? "All clear" : `${count} flagged`}
          </Text>
        </View>
        <Pressable
          onPress={onOpenClients}
          accessibilityRole="button"
          accessibilityLabel="All clients"
          testID="coach-home-all-clients"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View flexDirection="row" alignItems="center" gap={4}>
            <Text
              fontFamily="$display"
              fontWeight="500"
              fontSize={13}
              color="$primary"
            >
              All clients
            </Text>
            <IconChevronR {...iconDefaults({ size: 14 })} color="#22D3EE" />
          </View>
        </Pressable>
      </View>

      {count === 0 ? (
        <Card pad={16} radius={14} testID="coach-home-flagged-empty">
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={15}
            color="$text"
          >
            All clients on track
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3" marginTop={2}>
            No one needs your attention right now. Nice work.
          </Text>
        </Card>
      ) : (
        <Card pad={0} radius={14}>
          {clients.map((c, i) => (
            <Pressable
              key={c.clientId}
              onPress={() => onOpenClient(c.clientId)}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              testID={`coach-home-flagged-${c.clientId}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={10}
                paddingVertical={12}
                paddingHorizontal={14}
                borderTopWidth={i === 0 ? 0 : 1}
                borderColor="$border"
                minHeight={44}
              >
                <Avatar
                  initials={c.initials}
                  size={36}
                  tone={avatarTone(c.tone)}
                />
                <View flex={1} minWidth={0}>
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={15}
                    color="$text"
                    numberOfLines={1}
                  >
                    {c.name}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={11}
                    color={toneHex(c.tone).base}
                    numberOfLines={1}
                  >
                    {c.sub}
                  </Text>
                </View>
                <IconChevronR {...iconDefaults({ size: 14 })} color="#8A8A98" />
              </View>
            </Pressable>
          ))}
        </Card>
      )}
    </View>
  );
}
