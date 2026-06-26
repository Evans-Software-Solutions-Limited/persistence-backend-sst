import { Text, View } from "@tamagui/core";
import { Bar, Btn, Card, Ring } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconEdit, IconPlus } from "@/ui/components/icons";

/**
 * <MacroHeroPresenter> — Fuel screen hero (nutrition.jsx:46–105). A single gold
 * <Ring> filling with CONSUMED toward target, REMAINING kcal centred (mono), and
 * three macro lines (Protein/Carbs/Fat) as <Bar>s. Consumed·Target stat row +
 * EDIT + Log button at the bottom.
 *
 * Pure: every value is a prop. The container recomputes them from the cached
 * day aggregate after each optimistic write so the ring updates with no round-
 * trip. `celebrate` adds the immediate goal-hit flourish (glow) the moment the
 * day lands in the target band (FRONTEND_BRIEF § Immediate reward) — a hint, not
 * the durable streak (that's the cron's job).
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <MacroHeroPresenter>
 */

const GOLD = toneHex("gold").base;

export type MacroLineVM = {
  label: string;
  value: number;
  target: number;
  /** Concrete fill colour (SVG/Animated can't resolve Tamagui tokens). */
  color: string;
  /** Fill fraction 0..1 (container-computed, clamped). */
  pct: number;
};

export type MacroHeroProps = {
  remainingKcal: number;
  consumedKcal: number;
  targetKcal: number;
  /** Hero-ring fill fraction (consumed/target, clamped). */
  ringPct: number;
  macros: readonly MacroLineVM[];
  /** True when the day is within the goal band — fires the celebration glow. */
  celebrate?: boolean;
  /** True when no target is set yet (prompts the user to the Targets editor). */
  noTarget?: boolean;
  onOpenTargets: () => void;
  onLog: () => void;
  testID?: string;
};

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

function MacroLine({
  label,
  value,
  target,
  unit,
  color,
  pct,
}: MacroLineVM & { unit: string }) {
  return (
    <View testID={`fuel-macro-${label.toLowerCase()}`}>
      <View
        flexDirection="row"
        alignItems="baseline"
        justifyContent="space-between"
        marginBottom={4}
      >
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.5}
          textTransform="uppercase"
          color="$text3"
        >
          {label}
        </Text>
        <Text
          fontFamily="$mono"
          fontSize={11}
          color="$text2"
          fontVariant={["tabular-nums"]}
        >
          <Text color="$text">{intl(value)}</Text>
          {` / ${intl(target)}${unit}`}
        </Text>
      </View>
      <Bar pct={pct} color={color} height={5} />
    </View>
  );
}

export function MacroHeroPresenter({
  remainingKcal,
  consumedKcal,
  targetKcal,
  ringPct,
  macros,
  celebrate = false,
  noTarget = false,
  onOpenTargets,
  onLog,
  testID = "fuel-macro-hero",
}: MacroHeroProps) {
  return (
    <Card
      pad={20}
      radius={20}
      glow={celebrate ? "gold" : undefined}
      testID={testID}
    >
      <View flexDirection="row" alignItems="center" gap={20}>
        <Ring
          pct={ringPct}
          size={120}
          stroke={11}
          color={GOLD}
          glow
          testID="fuel-hero-ring"
          accessibilityLabel={`${intl(remainingKcal)} kilocalories remaining`}
        >
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$gold"
          >
            {celebrate ? "GOAL HIT" : "REMAINING"}
          </Text>
          <Text
            fontFamily="$mono"
            fontSize={26}
            fontWeight="600"
            color="$text"
            marginTop={2}
            fontVariant={["tabular-nums"]}
          >
            {intl(remainingKcal)}
          </Text>
          <Text fontFamily="$mono" fontSize={10} color="$text3">
            kcal
          </Text>
        </Ring>

        <View flex={1} gap={10}>
          {macros.map((m) => (
            <MacroLine key={m.label} {...m} unit="g" />
          ))}
        </View>
      </View>

      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginTop={16}
        paddingTop={14}
        borderTopWidth={1}
        borderColor="$border"
      >
        <View>
          <View flexDirection="row" alignItems="center" gap={6}>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.5}
              textTransform="uppercase"
              color="$text3"
            >
              Consumed · Target
            </Text>
            <Btn
              variant="ghost"
              tone="primary"
              size="sm"
              icon={<IconEdit size={10} />}
              onPress={onOpenTargets}
              testID="fuel-hero-edit"
              accessibilityLabel="Edit targets"
            >
              EDIT
            </Btn>
          </View>
          <View flexDirection="row" alignItems="baseline" gap={4} marginTop={4}>
            <Text
              fontFamily="$mono"
              fontSize={20}
              fontWeight="600"
              color="$text"
              fontVariant={["tabular-nums"]}
            >
              {intl(consumedKcal)}
            </Text>
            <Text
              fontFamily="$mono"
              fontSize={12}
              color="$text3"
              fontVariant={["tabular-nums"]}
            >
              {noTarget ? "/ — kcal" : `/ ${intl(targetKcal)} kcal`}
            </Text>
          </View>
        </View>
        <Btn
          variant="filled"
          tone="primary"
          size="sm"
          icon={<IconPlus size={14} strokeWidth={2.5} />}
          onPress={onLog}
          testID="fuel-hero-log"
        >
          Log
        </Btn>
      </View>
    </Card>
  );
}
