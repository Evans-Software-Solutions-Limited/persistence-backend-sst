import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import type { ClientHealthBand } from "@/domain/models/coachOverview";
import { DonutMini, type DonutSegment } from "./DonutMini";

/**
 * <ClientOverviewDonutPresenter> — Coach You client-health summary card.
 * Ports the prototype's `ClientOverview` (design-source/screens/coach.jsx:
 * 135-159): a `DonutMini` left, a legend right (CLIENT HEALTH eyebrow + a row
 * per band with a colour chip, label, and count). Trainer-purple is not used
 * here — bands are success / gold / ember, matching the prototype.
 *
 * Exported separately so Coach Home can reuse it later.
 */

export type ClientOverviewDonutPresenterProps = {
  breakdown: { band: ClientHealthBand; count: number }[];
  testID?: string;
};

const BAND_META: Record<
  ClientHealthBand,
  { label: string; tone: "success" | "gold" | "ember" }
> = {
  strong: { label: "Strong (85%+)", tone: "success" },
  wobbling: { label: "Wobbling (65-84%)", tone: "gold" },
  atRisk: { label: "At risk (<65%)", tone: "ember" },
};

/** Stable band order for the legend + donut segments. */
const BAND_ORDER: ClientHealthBand[] = ["strong", "wobbling", "atRisk"];

export function ClientOverviewDonutPresenter({
  breakdown,
  testID,
}: ClientOverviewDonutPresenterProps) {
  const countOf = (band: ClientHealthBand) =>
    breakdown.find((b) => b.band === band)?.count ?? 0;

  const rows = BAND_ORDER.map((band) => ({
    band,
    label: BAND_META[band].label,
    color: toneHex(BAND_META[band].tone).base,
    count: countOf(band),
  }));

  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const segments: DonutSegment[] = rows.map((r) => ({
    color: r.color,
    count: r.count,
  }));

  return (
    <Card pad={16} radius={16} testID={testID}>
      <View flexDirection="row" alignItems="center" gap={16}>
        <DonutMini total={total} segments={segments} testID="coach-donut" />
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={6}
          >
            Client health
          </Text>
          {rows.map((r) => (
            <View
              key={r.band}
              flexDirection="row"
              alignItems="center"
              gap={8}
              paddingVertical={3}
            >
              <View
                width={8}
                height={8}
                borderRadius={2}
                style={{ backgroundColor: r.color }}
              />
              <Text flex={1} color="$text2" fontSize={12} fontFamily="$body">
                {r.label}
              </Text>
              <Text
                fontFamily="$mono"
                fontWeight="600"
                fontSize={13}
                color="$text"
              >
                {r.count}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}
