import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import {
  toneHex,
  toneTokens,
  type Tone,
} from "@/ui/components/foundation/tones";
import { IconX } from "@/ui/components/icons";

/**
 * <AdherenceLegend> — the "HOW ADHERENCE IS SCORED" explainer card.
 * Ports the prototype's `AdherenceLegend` + `LegendRange`
 * (design-source/screens/coach.jsx:474-504) 1:1 — trainer-accent left border,
 * the composite-metric blurb, and the four labelled ranges.
 */

const RANGES: { label: string; range: string; tone: Tone }[] = [
  { label: "Stellar", range: "95+", tone: "gold" },
  { label: "Strong", range: "85-94", tone: "success" },
  { label: "Wobbling", range: "65-84", tone: "gold" },
  { label: "At risk", range: "<65", tone: "ember" },
];

function LegendRange({
  label,
  range,
  tone,
}: {
  label: string;
  range: string;
  tone: Tone;
}) {
  const t = toneTokens(tone);
  return (
    <View
      flex={1}
      padding={8}
      borderRadius={8}
      backgroundColor={t.dim}
      borderColor={t.dim}
      borderWidth={1}
    >
      <Text
        fontFamily="$display"
        fontSize={10}
        fontWeight="700"
        letterSpacing={0.6}
        textTransform="uppercase"
        color={t.base}
      >
        {label}
      </Text>
      <Text fontFamily="$mono" fontSize={10.5} color="$text2">
        {`${range}%`}
      </Text>
    </View>
  );
}

export type AdherenceLegendProps = {
  onClose: () => void;
  testID?: string;
};

export function AdherenceLegend({ onClose, testID }: AdherenceLegendProps) {
  return (
    <Card
      pad={14}
      radius={12}
      testID={testID}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: toneHex("trainer").base,
      }}
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={8}
      >
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.7}
          textTransform="uppercase"
          color="$accentTrainer"
        >
          How adherence is scored
        </Text>
        <IconBtn
          icon={<IconX size={12} />}
          size={22}
          tone="ghost"
          onPress={onClose}
          accessibilityLabel="Hide adherence explanation"
          testID={testID ? `${testID}-close` : undefined}
        />
      </View>
      <Text
        fontFamily="$body"
        fontSize={12}
        lineHeight={18}
        color="$text2"
        marginBottom={10}
      >
        Composite of workouts completed, nutrition targets hit, daily check-ins,
        and sleep targets, weighted by the client&apos;s programme.
      </Text>
      <View flexDirection="row" gap={8}>
        {RANGES.map((r) => (
          <LegendRange
            key={r.label}
            label={r.label}
            range={r.range}
            tone={r.tone}
          />
        ))}
      </View>
    </Card>
  );
}
