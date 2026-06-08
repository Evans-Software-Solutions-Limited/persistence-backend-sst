import { Text, View } from "@tamagui/core";
import { Card, Stat, Bar } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import type { VolumeStats } from "@/domain/models/progress";

/**
 * <VolumeStatsPresenter> — You/Progress training stats (06-progress-goals,
 * STORY-003 AC 3.5; progress.jsx:196–225). 3-up Stat grid (workouts / volume
 * tonnes / adherence) over horizontal volume-by-muscle bars.
 */

export type VolumeStatsProps = {
  stats: VolumeStats;
  testID?: string;
};

const cap = (s: string) => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

export function VolumeStatsPresenter({
  stats,
  testID = "volume-stats",
}: VolumeStatsProps) {
  return (
    <Card pad={16} radius={16} testID={testID}>
      <View
        flexDirection="row"
        paddingBottom={12}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View flex={1}>
          <Stat
            value={stats.workouts}
            size="md"
            label="WORKOUTS"
            sub="this month"
          />
        </View>
        <View flex={1}>
          <Stat
            value={stats.totalTonnes.toFixed(1)}
            unit="t"
            size="md"
            label="VOLUME"
            sub="lifted"
          />
        </View>
        <View flex={1}>
          <Stat
            value={stats.adherencePct ?? "--"}
            unit={stats.adherencePct != null ? "%" : undefined}
            size="md"
            label="ADHERENCE"
            sub="of plan"
            tone="primary"
          />
        </View>
      </View>

      <View marginTop={14}>
        <View
          flexDirection="row"
          justifyContent="space-between"
          marginBottom={8}
        >
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$text3"
          >
            VOLUME BY MUSCLE
          </Text>
          <Text fontFamily="$mono" fontSize={11} color="$text3">
            kg
          </Text>
        </View>
        {stats.byMuscle.map((m) => (
          <View
            key={m.muscle}
            flexDirection="row"
            alignItems="center"
            gap={10}
            paddingVertical={6}
          >
            <Text width={70} fontSize={12.5} color="$text2">
              {cap(m.muscle)}
            </Text>
            <View flex={1}>
              <Bar pct={m.pct} color={toneHex("primary").base} height={5} />
            </View>
            <Text
              fontFamily="$mono"
              fontSize={11}
              color="$text3"
              width={56}
              textAlign="right"
            >
              {Math.round(m.kg).toLocaleString("en-US")}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
