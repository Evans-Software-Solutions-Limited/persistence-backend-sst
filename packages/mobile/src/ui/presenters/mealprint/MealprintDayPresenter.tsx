import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import {
  IconBasket,
  IconCalendar,
  IconCheck,
  IconMinus,
  IconPlus,
  IconSparkles,
  IconSwap,
  IconWarning,
} from "@/ui/components/icons";
import { MAX_STEER_LENGTH } from "@/domain/models/mealprint";
import { BackBtn } from "@/ui/presenters/fuel/plans/PlanChrome";
import {
  AMBER,
  AiCaveats,
  HeroNumber,
  MACRO_COLOURS,
  MealprintPage,
  StatStrip,
  fmtKcal,
} from "./MealprintChrome";
import { ChoiceChip } from "./MealprintHomePresenter";

/**
 * <MealprintDayPresenter> — canvas N19 "Whole day" and N20 "Swap a meal"
 * (PER-134): a builder. Every meal has its own Swap button; the panel offers
 * three replacements with what's in them, kcal and the difference from the
 * current meal (amber past ±40 kcal), a feedback box with steer chips, "Show
 * 3 others" and "Keep this meal". One panel at a time; the other meals
 * shrink to one line meanwhile. Tap a meal's name for its portion
 * (0.25–2), Undo swap and Remove. A flagged meal (CHECK) blocks the two ways
 * out until it is swapped. Pure.
 */

export type DayMealVM = {
  localId: string;
  /** The person's meal ("Breakfast"). */
  slot: string;
  name: string;
  /** "Oats 80 g · whey 1 scoop · blueberries 80 g". */
  items: string;
  kcal: number;
  flagged: boolean;
  swapped: boolean;
  /** "×1", "×1.25". */
  portionLabel: string;
  canLess: boolean;
  canMore: boolean;
};

export type SwapOptionVM = {
  name: string;
  items: string;
  kcal: number;
  /** "+12 kcal". */
  delta: string;
  /** Within ±40 kcal: grey, else amber. */
  deltaQuiet: boolean;
};

export type SwapPanelVM = {
  localId: string;
  feedback: string;
  onFeedback: (text: string) => void;
  feedbackError: string | null;
  /** The feedback the shown options were asked for, if any. */
  sentFor: string | null;
  chips: readonly { label: string; on: boolean }[];
  onChip: (label: string) => void;
  options: readonly SwapOptionVM[];
  loading: boolean;
  error: string | null;
  onSend: () => void;
  onPick: (index: number) => void;
  onMore: () => void;
  moreDisabled: boolean;
  onClose: () => void;
  /** "Keep this meal", or "Close" for a flagged meal. */
  closeLabel: string;
};

export type MealprintDayProps = {
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  target: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  meals: readonly DayMealVM[];
  /** The meal whose portion controls are open. */
  openId: string | null;
  swap: SwapPanelVM | null;
  onTapMeal: (localId: string) => void;
  onSwap: (localId: string) => void;
  onLess: (localId: string) => void;
  onMore: (localId: string) => void;
  onUndo: (localId: string) => void;
  onRemove: (localId: string) => void;
  dietaryPatterns: readonly string[];
  /** Save / Log all are blocked (flagged meal, a swap open, no meals). */
  blockedLabel: string | null;
  busy: boolean;
  errorMessage: string | null;
  /** A way out of the error ("Replace it", "Start over"). */
  errorAction: { label: string; onPress: () => void } | null;
  onLogAll: () => void;
  onSave: () => void;
  onShoppingList: () => void;
  onBack: () => void;
  testID?: string;
};

function Pill({ label, tone }: { label: string; tone: "amber" | "cyan" }) {
  return (
    <View
      height={20}
      paddingHorizontal={8}
      borderRadius={6}
      backgroundColor={
        tone === "amber" ? "rgba(251,191,36,0.14)" : "rgba(34,211,238,0.12)"
      }
      justifyContent="center"
    >
      <Text
        fontFamily="$body"
        fontSize={10}
        fontWeight="700"
        letterSpacing={1.4}
        color={tone === "amber" ? AMBER : "$primary"}
      >
        {label}
      </Text>
    </View>
  );
}

function SmallBtn({
  label,
  onPress,
  danger = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  testID: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}>
      <View
        height={36}
        paddingHorizontal={12}
        borderRadius={10}
        borderWidth={1}
        borderColor="rgba(255,255,255,0.12)"
        justifyContent="center"
      >
        <Text
          fontFamily="$body"
          fontSize={12.5}
          fontWeight="600"
          color={danger ? "$error" : "$text"}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SwapPanel({ panel, testID }: { panel: SwapPanelVM; testID: string }) {
  return (
    <View gap={8} paddingTop={2} paddingBottom={4} testID={testID}>
      <View flexDirection="row" gap={8} alignItems="center">
        <TextInput
          value={panel.feedback}
          onChangeText={panel.onFeedback}
          placeholder="e.g. something warm, no rice, under 600 kcal"
          placeholderTextColor="#5C5C68"
          maxLength={MAX_STEER_LENGTH}
          returnKeyType="send"
          onSubmitEditing={panel.onSend}
          accessibilityLabel="Tell Mealprint what would work better"
          testID={`${testID}-feedback`}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 12,
            backgroundColor: "#12141D",
            borderWidth: 1,
            borderColor: panel.feedbackError
              ? "#F87171"
              : "rgba(255,255,255,0.10)",
            paddingHorizontal: 12,
            color: "#F4F4F8",
            fontSize: 14,
          }}
        />
        <Pressable
          onPress={panel.onSend}
          disabled={panel.loading}
          accessibilityRole="button"
          accessibilityLabel="Update ideas with your feedback"
          accessibilityState={{ disabled: panel.loading }}
          testID={`${testID}-send`}
        >
          <View
            width={44}
            height={44}
            borderRadius={9999}
            backgroundColor="$primary"
            alignItems="center"
            justifyContent="center"
            opacity={panel.loading ? 0.5 : 1}
          >
            <IconSparkles size={18} color="#042F39" />
          </View>
        </Pressable>
      </View>
      {panel.feedbackError ? (
        <Text fontFamily="$body" fontSize={12} color="$error">
          {panel.feedbackError}
        </Text>
      ) : null}
      {panel.sentFor ? (
        <View flexDirection="row" gap={6} alignItems="center">
          <IconCheck size={12} color="#8A8A98" />
          <Text
            flex={1}
            fontFamily="$body"
            fontSize={11.5}
            lineHeight={15}
            color="$text3"
            testID={`${testID}-sent`}
          >
            {`Updated for “${panel.sentFor}” · your food preferences still apply`}
          </Text>
        </View>
      ) : null}
      <View flexDirection="row" flexWrap="wrap" gap={6}>
        {panel.chips.map((chip) => (
          <ChoiceChip
            key={chip.label}
            label={chip.label}
            selected={chip.on}
            role="button"
            height={32}
            onPress={() => panel.onChip(chip.label)}
            testID={`${testID}-chip-${chip.label}`}
          />
        ))}
      </View>
      {panel.loading ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          paddingVertical={12}
          testID={`${testID}-loading`}
        >
          Finding three options…
        </Text>
      ) : panel.error ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$warning"
          paddingVertical={8}
          testID={`${testID}-error`}
        >
          {panel.error}
        </Text>
      ) : (
        <View gap={6} accessibilityRole="radiogroup">
          {panel.options.map((o, i) => (
            <Pressable
              key={`${o.name}-${i}`}
              onPress={() => panel.onPick(i)}
              accessibilityRole="radio"
              accessibilityState={{ checked: false }}
              accessibilityLabel={`${o.name}, ${Math.round(o.kcal)} kcal, ${o.delta}`}
              testID={`${testID}-option-${i}`}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={10}
                minHeight={52}
                paddingVertical={8}
                paddingHorizontal={12}
                borderRadius={12}
                backgroundColor="$surface"
                borderWidth={1}
                borderColor="$border"
              >
                <View flex={1} gap={2}>
                  <Text
                    fontFamily="$body"
                    fontSize={14}
                    fontWeight="600"
                    color="$text"
                  >
                    {o.name}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={11.5}
                    color="$text3"
                    numberOfLines={1}
                  >
                    {o.items}
                  </Text>
                </View>
                <View alignItems="flex-end" gap={2}>
                  <Text
                    fontFamily="$mono"
                    fontSize={14}
                    fontWeight="600"
                    color="$text"
                  >
                    {fmtKcal(o.kcal)}
                  </Text>
                  <Text
                    fontFamily="$mono"
                    fontSize={11}
                    color={o.deltaQuiet ? "$text3" : AMBER}
                  >
                    {o.delta}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <View
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Pressable
          onPress={panel.onMore}
          disabled={panel.moreDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: panel.moreDisabled }}
          testID={`${testID}-more`}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <View flexDirection="row" alignItems="center" gap={6}>
            <IconSwap
              size={14}
              color={panel.moreDisabled ? "#5C5C68" : "#22D3EE"}
            />
            <Text
              fontFamily="$body"
              fontSize={13}
              fontWeight="600"
              color={panel.moreDisabled ? "$text4" : "$primary"}
            >
              Show 3 others
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={panel.onClose}
          accessibilityRole="button"
          testID={`${testID}-close`}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text
            fontFamily="$body"
            fontSize={13}
            fontWeight="600"
            color="$text2"
          >
            {panel.closeLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MealprintDayPresenter(p: MealprintDayProps) {
  const testID = p.testID ?? "mealprint-day";
  const swappingId = p.swap?.localId ?? null;
  const pct =
    p.target.kcal > 0 ? Math.min(1, p.totals.kcal / p.target.kcal) : 0;

  return (
    <MealprintPage
      testID={testID}
      left={<BackBtn onPress={p.onBack} testID={`${testID}-back`} />}
      eyebrow="Mealprint · your day"
      footer={
        <>
          {p.errorMessage ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$error"
              textAlign="center"
              testID={`${testID}-error`}
            >
              {p.errorMessage}
            </Text>
          ) : null}
          {p.errorAction ? (
            <Btn
              variant="soft"
              tone="primary"
              size="md"
              full
              onPress={p.errorAction.onPress}
              testID={`${testID}-error-action`}
            >
              {p.errorAction.label}
            </Btn>
          ) : null}
          {p.blockedLabel ? (
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              disabled
              onPress={() => undefined}
              testID={`${testID}-blocked`}
            >
              {p.blockedLabel}
            </Btn>
          ) : (
            <>
              <View flexDirection="row" gap={10}>
                <View flex={1}>
                  <Btn
                    variant="outline"
                    tone="primary"
                    size="lg"
                    full
                    icon={<IconCheck size={16} color="#F4F4F8" />}
                    disabled={p.busy}
                    onPress={p.onLogAll}
                    testID={`${testID}-log-all`}
                  >
                    Log all today
                  </Btn>
                </View>
                <View flex={1.2}>
                  <Btn
                    variant="filled"
                    tone="primary"
                    size="lg"
                    full
                    icon={<IconCalendar size={16} />}
                    disabled={p.busy}
                    onPress={p.onSave}
                    testID={`${testID}-save`}
                  >
                    Save as a plan
                  </Btn>
                </View>
              </View>
              <Pressable
                onPress={p.onShoppingList}
                disabled={p.busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: p.busy }}
                testID={`${testID}-shopping`}
                style={{
                  minHeight: 44,
                  alignSelf: "center",
                  justifyContent: "center",
                }}
              >
                <View flexDirection="row" alignItems="center" gap={6}>
                  <IconBasket size={16} color="#22D3EE" />
                  <Text
                    fontFamily="$body"
                    fontSize={15}
                    fontWeight="600"
                    color="$primary"
                  >
                    Add to shopping list
                  </Text>
                </View>
              </Pressable>
            </>
          )}
        </>
      }
    >
      <HeroNumber
        value={fmtKcal(p.totals.kcal)}
        unit={`of ${fmtKcal(p.target.kcal)} kcal`}
        size={48}
        testID={`${testID}-total`}
      />
      <View
        marginTop={8}
        height={6}
        borderRadius={9999}
        backgroundColor="$surface3"
        overflow="hidden"
      >
        <View
          height={6}
          width={`${(pct * 100).toFixed(1)}%`}
          borderRadius={9999}
          backgroundColor="$primary"
        />
      </View>
      <StatStrip
        marginTop={8}
        borderTop={false}
        cells={[
          {
            value: `${Math.round(p.totals.proteinG)}/${Math.round(p.target.proteinG)}`,
            label: "Protein",
            colour: MACRO_COLOURS.protein,
          },
          {
            value: `${Math.round(p.totals.carbsG)}/${Math.round(p.target.carbsG)}`,
            label: "Carbs",
            colour: MACRO_COLOURS.carbs,
          },
          {
            value: `${Math.round(p.totals.fatG)}/${Math.round(p.target.fatG)}`,
            label: "Fat",
            colour: MACRO_COLOURS.fat,
          },
        ]}
      />

      <View>
        {p.meals.map((m) => {
          const swapping = swappingId === m.localId;
          const open = p.openId === m.localId && !swapping;
          const showItems = swappingId === null || swapping;
          return (
            <View
              key={m.localId}
              paddingVertical={6}
              borderBottomWidth={1}
              borderColor={swapping ? "rgba(34,211,238,0.35)" : "$border2"}
              gap={6}
              testID={`${testID}-meal-${m.localId}`}
            >
              <View flexDirection="row" alignItems="center" gap={6}>
                <Pressable
                  onPress={() => p.onTapMeal(m.localId)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${m.slot}: ${m.name}, ${Math.round(m.kcal)} kcal`}
                  testID={`${testID}-meal-${m.localId}-tap`}
                  style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                >
                  <View flexDirection="row" alignItems="center" gap={8}>
                    <View flex={1} gap={3}>
                      <View flexDirection="row" gap={8} alignItems="center">
                        <Text
                          fontFamily="$display"
                          fontSize={10}
                          fontWeight="600"
                          letterSpacing={2}
                          textTransform="uppercase"
                          color="$text3"
                        >
                          {m.slot}
                        </Text>
                        {m.flagged ? <Pill label="CHECK" tone="amber" /> : null}
                        {m.swapped ? (
                          <Pill label="SWAPPED" tone="cyan" />
                        ) : null}
                      </View>
                      <Text
                        fontFamily="$body"
                        fontSize={15}
                        fontWeight="600"
                        color="$text"
                      >
                        {m.name}
                      </Text>
                      {showItems ? (
                        <Text fontFamily="$body" fontSize={12} color="$text3">
                          {m.items}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      fontFamily="$mono"
                      fontSize={15}
                      fontWeight="600"
                      color="$text"
                    >
                      {fmtKcal(m.kcal)}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => p.onSwap(m.localId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Swap ${m.slot}`}
                  accessibilityState={{ selected: swapping }}
                  testID={`${testID}-meal-${m.localId}-swap`}
                >
                  <View
                    width={44}
                    height={44}
                    borderRadius={9999}
                    alignItems="center"
                    justifyContent="center"
                    borderWidth={1}
                    backgroundColor={
                      swapping
                        ? "rgba(34,211,238,0.14)"
                        : "rgba(255,255,255,0.06)"
                    }
                    borderColor={
                      swapping
                        ? "rgba(34,211,238,0.5)"
                        : m.flagged
                          ? "rgba(251,191,36,0.45)"
                          : "rgba(255,255,255,0.08)"
                    }
                  >
                    <IconSwap
                      size={18}
                      color={
                        swapping ? "#22D3EE" : m.flagged ? AMBER : "#C2C2CE"
                      }
                    />
                  </View>
                </Pressable>
              </View>
              {m.flagged && !swapping ? (
                <View flexDirection="row" gap={6}>
                  <IconWarning size={14} color={AMBER} />
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontSize={12.5}
                    lineHeight={17}
                    color="$warning"
                  >
                    This meal needs a swap before you can accept.
                  </Text>
                </View>
              ) : null}
              {open ? (
                <View
                  flexDirection="row"
                  gap={8}
                  alignItems="center"
                  testID={`${testID}-meal-${m.localId}-controls`}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    height={36}
                    borderRadius={9999}
                    borderWidth={1}
                    borderColor="rgba(255,255,255,0.12)"
                    accessibilityLabel="Portion"
                  >
                    <Pressable
                      onPress={() => p.onLess(m.localId)}
                      disabled={!m.canLess}
                      accessibilityRole="button"
                      accessibilityLabel="Less"
                      accessibilityState={{ disabled: !m.canLess }}
                      testID={`${testID}-meal-${m.localId}-less`}
                      style={{
                        width: 40,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <IconMinus
                        size={16}
                        color={m.canLess ? "#22D3EE" : "#5C5C68"}
                      />
                    </Pressable>
                    <Text
                      fontFamily="$mono"
                      fontSize={13}
                      fontWeight="600"
                      minWidth={44}
                      textAlign="center"
                      color="$text"
                      testID={`${testID}-meal-${m.localId}-portion`}
                    >
                      {m.portionLabel}
                    </Text>
                    <Pressable
                      onPress={() => p.onMore(m.localId)}
                      disabled={!m.canMore}
                      accessibilityRole="button"
                      accessibilityLabel="More"
                      accessibilityState={{ disabled: !m.canMore }}
                      testID={`${testID}-meal-${m.localId}-more`}
                      style={{
                        width: 40,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <IconPlus
                        size={16}
                        color={m.canMore ? "#22D3EE" : "#5C5C68"}
                      />
                    </Pressable>
                  </View>
                  <View flex={1} />
                  {m.swapped ? (
                    <SmallBtn
                      label="Undo swap"
                      onPress={() => p.onUndo(m.localId)}
                      testID={`${testID}-meal-${m.localId}-undo`}
                    />
                  ) : null}
                  <SmallBtn
                    label="Remove"
                    danger
                    onPress={() => p.onRemove(m.localId)}
                    testID={`${testID}-meal-${m.localId}-remove`}
                  />
                </View>
              ) : null}
              {swapping && p.swap ? (
                <SwapPanel panel={p.swap} testID={`${testID}-swap`} />
              ) : null}
            </View>
          );
        })}
      </View>
      <AiCaveats
        dietaryPatterns={p.dietaryPatterns}
        testID={`${testID}-caveat`}
      />
    </MealprintPage>
  );
}
