import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Avatar, Card, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconChevronR, iconDefaults } from "@/ui/components/icons";

/**
 * <ScheduleHeroPresenter> / <ScheduleRow> — Coach Home "Today's Schedule" hero.
 * Ports the prototype `CoachHome` schedule block (design-source/screens/
 * coach-home.jsx:58-79 + ScheduleRow 159-191) 1:1.
 *
 * ⚠ DEFERRED from Coach Home v1 (Brad decision #1, 2026-07-05). There is no
 * appointments / booking / calendar domain in the backend, so nothing populates
 * `schedule`. This presenter is retained (per design.md L385-399) so the hero
 * re-enables UNCHANGED once the appointments spec lands: the container just
 * needs to pass a non-empty `schedule` to <CoachHomePresenter>, which gates the
 * render on it. Until then <CoachHomePresenter> never passes it and this never
 * renders.
 */

export type ScheduleItemVM = {
  start: string;
  end: string;
  clientId: string;
  name: string;
  initials: string;
  kind: "session" | "check-in" | "review";
  /** Row accent tone (primary|gold|trainer|success…); avatar-mapped below. */
  tone: string;
  /** e.g. "In-person · Studio A" | "Video call". */
  mode: string;
  /** Imminent appointment → shows a "starts in 6m" ember suffix. */
  soon?: boolean;
};

export type ScheduleHeroPresenterProps = {
  schedule: ScheduleItemVM[];
  onOpenAppointment: (clientId: string) => void;
  testID?: string;
};

/** Restrict the free-form row tone to the three Avatar tones. */
function avatarTone(tone: string): "primary" | "gold" | "trainer" {
  if (tone === "trainer") return "trainer";
  if (tone === "primary") return "primary";
  return "gold";
}

function ScheduleRow({
  row,
  isLast,
  onPress,
}: {
  row: ScheduleItemVM;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.start} ${row.name}`}
      testID={`coach-home-schedule-${row.clientId}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        paddingHorizontal={14}
        borderTopWidth={1}
        borderColor="$border"
      >
        <View width={50} alignItems="center">
          <Text fontFamily="$mono" fontSize={13} fontWeight="600" color="$text">
            {row.start}
          </Text>
          <Text fontFamily="$mono" fontSize={10} color="$text3" marginTop={3}>
            {row.end}
          </Text>
        </View>
        <Avatar initials={row.initials} size={32} tone={avatarTone(row.tone)} />
        <View flex={1} minWidth={0}>
          <View flexDirection="row" alignItems="center" gap={6}>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={13}
              color="$text"
              numberOfLines={1}
              flex={1}
            >
              {row.name}
            </Text>
            {row.kind === "session" ? (
              <Pill tone="trainer" size="xs">
                SESSION
              </Pill>
            ) : null}
            {row.kind === "check-in" ? (
              <Pill tone="success" size="xs">
                CHECK-IN
              </Pill>
            ) : null}
            {row.kind === "review" ? (
              <Pill tone="gold" size="xs">
                REVIEW
              </Pill>
            ) : null}
          </View>
          <Text
            fontFamily="$body"
            fontSize={11}
            color="$text3"
            marginTop={2}
            numberOfLines={1}
          >
            {row.mode}
            {row.soon ? (
              <Text color={toneHex("ember").base} fontWeight="600">
                {"  · starts in 6m"}
              </Text>
            ) : null}
          </Text>
        </View>
        <IconChevronR {...iconDefaults({ size: 14 })} color="#8A8A98" />
      </View>
    </Pressable>
  );
}

export function ScheduleHeroPresenter({
  schedule,
  onOpenAppointment,
  testID,
}: ScheduleHeroPresenterProps) {
  if (schedule.length === 0) return null;

  return (
    <Card pad={0} radius={20} accent="trainer" testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingTop={14}
        paddingBottom={8}
        paddingHorizontal={16}
      >
        <View>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$accentTrainer"
          >
            {"Today's Schedule"}
          </Text>
          <View flexDirection="row" alignItems="baseline" gap={8} marginTop={4}>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={28}
              color="$text"
            >
              {schedule.length}
            </Text>
            <Text fontFamily="$body" fontSize={13} color="$text2">
              appointments
            </Text>
          </View>
        </View>
      </View>
      <View>
        {schedule.map((s) => (
          <ScheduleRow
            key={s.clientId}
            row={s}
            isLast={false}
            onPress={() => onOpenAppointment(s.clientId)}
          />
        ))}
      </View>
    </Card>
  );
}
