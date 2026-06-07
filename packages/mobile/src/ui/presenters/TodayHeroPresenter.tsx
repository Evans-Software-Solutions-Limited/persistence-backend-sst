import { Text, View } from "@tamagui/core";
import { Card, MultiRing, Stat } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { MicroPill, RingLegend } from "@/ui/components/composite";
import {
  IconFlame,
  IconDroplet,
  IconBolt,
  IconClock,
} from "@/ui/components/icons";

/**
 * <TodayHeroPresenter> — Home 3-ring hero (06-progress-goals, STORY-001;
 * home.jsx:83–120). MultiRing (Move=$primary · Train=$ember · Fuel=$gold) with
 * a centred TODAY% (avg of non-gated rings) + a 4-up micro-pill strip.
 * Fuel is "gated" until M9 → 0% fill + "--".
 */

export type RingDatumVM = {
  current: number;
  target: number;
  pct: number;
  unit: string;
};

export type TodayHeroProps = {
  rings: {
    move: RingDatumVM;
    train: RingDatumVM;
    fuel: RingDatumVM | "gated";
  };
  micro: {
    streak: number;
    water: string | null;
    strain: number | null;
    sleep: string | null;
  };
  onOpenMove?: () => void;
  onOpenTrain?: () => void;
  onOpenFuel?: () => void;
  testID?: string;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function TodayHeroPresenter({
  rings,
  micro,
  onOpenMove,
  onOpenTrain,
  onOpenFuel,
  testID = "today-hero",
}: TodayHeroProps) {
  const fuel = rings.fuel === "gated" ? null : rings.fuel;
  const todayPct = Math.round(((rings.move.pct + rings.train.pct) / 2) * 100);

  return (
    <Card pad={0} radius={20} testID={testID}>
      <View
        flexDirection="row"
        gap={18}
        alignItems="center"
        padding={20}
        paddingBottom={18}
      >
        <MultiRing
          size={120}
          stroke={9}
          rings={[
            { pct: rings.move.pct, color: toneHex("primary").base },
            { pct: rings.train.pct, color: toneHex("ember").base },
            { pct: fuel?.pct ?? 0, color: toneHex("gold").base },
          ]}
        >
          <View alignItems="center" justifyContent="center">
            <Text
              fontSize={9}
              fontWeight="600"
              letterSpacing={1.5}
              color="$text3"
            >
              TODAY
            </Text>
            <Stat value={todayPct} unit="%" size="md" align="center" />
          </View>
        </MultiRing>

        <View flex={1} gap={12}>
          <View onPress={onOpenMove} accessibilityLabel="Open Move detail">
            <RingLegend
              color={toneHex("primary").base}
              label="MOVE"
              value={fmt(rings.move.current)}
              sub={rings.move.unit}
              pct={rings.move.pct}
            />
          </View>
          <View onPress={onOpenTrain} accessibilityLabel="Open Train detail">
            <RingLegend
              color={toneHex("ember").base}
              label="TRAIN"
              value={fmt(rings.train.current)}
              sub={rings.train.unit}
              pct={rings.train.pct}
            />
          </View>
          <View onPress={onOpenFuel} accessibilityLabel="Open Fuel detail">
            <RingLegend
              color={toneHex("gold").base}
              label="FUEL"
              value={fuel ? fmt(fuel.current) : "--"}
              sub={fuel?.unit ?? "kcal"}
              pct={fuel?.pct ?? 0}
            />
          </View>
        </View>
      </View>

      <View
        flexDirection="row"
        gap={6}
        padding={14}
        paddingVertical={10}
        borderTopWidth={1}
        borderColor="$border"
      >
        <MicroPill
          icon={<IconFlame size={14} color={toneHex("ember").base} />}
          value={String(micro.streak)}
          label="streak"
          tone="ember"
        />
        <MicroPill
          icon={<IconDroplet size={14} color={toneHex("primary").base} />}
          value={micro.water ?? "—"}
          label="water"
          tone="primary"
        />
        <MicroPill
          icon={<IconBolt size={14} color={toneHex("trainer").base} />}
          value={micro.strain != null ? String(micro.strain) : "—"}
          label="strain"
          tone="trainer"
        />
        <MicroPill
          icon={<IconClock size={14} color={toneHex("success").base} />}
          value={micro.sleep ?? "—"}
          label="sleep"
          tone="success"
        />
      </View>
    </Card>
  );
}
