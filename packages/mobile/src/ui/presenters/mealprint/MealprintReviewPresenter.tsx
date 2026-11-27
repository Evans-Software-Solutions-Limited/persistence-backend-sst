import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Utensils } from "lucide-react-native";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  IconCheck,
  IconChevronD,
  IconChevronL,
} from "@/ui/components/icons";
import { SheetTitle } from "@/ui/presenters/fuel/plans/PlanChrome";
import {
  AiCaveats,
  HeroNumber,
  MealprintPage,
  SectionEyebrow,
  StatStrip,
  fmtKcal,
  macroCells,
} from "./MealprintChrome";

/**
 * <MealprintReviewPresenter> — canvas N18 "Review and log" (PER-134): the
 * idea's name, live totals for what's ticked, "What's in it" with a tick per
 * item, "Log to" any of Your meals, the label-check copy, then one button.
 * Nothing is logged until the button is pressed. Pure.
 */

export type ReviewItemVM = {
  name: string;
  /** "1.5 × 100 g". */
  serving: string;
  kcal: number;
  on: boolean;
};

export type LogToMealVM = { id: string; name: string };

export type MealprintReviewProps = {
  name: string;
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  items: readonly ReviewItemVM[];
  onToggleItem: (index: number) => void;
  logToName: string;
  logToMeals: readonly LogToMealVM[];
  logToSelectedId: string;
  logToOpen: boolean;
  onOpenLogTo: () => void;
  onPickLogTo: (id: string) => void;
  onCloseLogTo: () => void;
  dietaryPatterns: readonly string[];
  serverPartialEnforcementOnly: boolean;
  /** Logging, then briefly "Added ✓". */
  confirming: boolean;
  added: boolean;
  /** Part of the log went in and part didn't: nothing can be retried here. */
  errorMessage: string | null;
  onLog: () => void;
  onBackToIdeas: () => void;
  testID?: string;
};

export function MealprintReviewPresenter(p: MealprintReviewProps) {
  const testID = p.testID ?? "mealprint-review";
  const anyOn = p.items.some((i) => i.on);
  const cta = p.added
    ? "Added ✓"
    : anyOn
      ? `Log ${fmtKcal(p.totals.kcal)} kcal`
      : "Pick something to log";

  return (
    <MealprintPage
      testID={testID}
      left={
        <Pressable
          onPress={p.onBackToIdeas}
          accessibilityRole="button"
          accessibilityLabel="Back to ideas"
          testID={`${testID}-back`}
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            paddingRight: 4,
          }}
        >
          <IconChevronL size={18} color="#22D3EE" />
          <Text
            fontFamily="$body"
            fontSize={15}
            fontWeight="600"
            color="$primary"
          >
            Ideas
          </Text>
        </Pressable>
      }
      eyebrow="Review and log"
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
          <Btn
            variant="filled"
            tone={p.added ? "success" : "primary"}
            size="lg"
            full
            disabled={
              !anyOn || p.confirming || p.added || p.errorMessage !== null
            }
            onPress={p.onLog}
            testID={`${testID}-log`}
          >
            {cta}
          </Btn>
        </>
      }
    >
      <View flexDirection="row" gap={14} alignItems="center" marginTop={4}>
        <View
          width={64}
          height={64}
          borderRadius={14}
          backgroundColor="$surface2"
          alignItems="center"
          justifyContent="center"
        >
          <Utensils size={24} color="#5C5C68" />
        </View>
        <Text
          flex={1}
          fontFamily="$display"
          fontSize={24}
          lineHeight={29}
          fontWeight="800"
          letterSpacing={-0.5}
          color="$text"
          accessibilityRole="header"
        >
          {p.name}
        </Text>
      </View>
      <View marginTop={14}>
        <HeroNumber
          value={fmtKcal(p.totals.kcal)}
          unit="kcal"
          size={64}
          testID={`${testID}-kcal`}
        />
      </View>
      <StatStrip cells={macroCells(p.totals)} marginTop={10} />

      <SectionEyebrow marginTop={20}>What&apos;s in it</SectionEyebrow>
      <View>
        {p.items.map((item, i) => (
          <Pressable
            key={`${item.name}-${i}`}
            onPress={() => p.onToggleItem(i)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.on }}
            accessibilityLabel={`${item.name}, ${item.serving}, ${Math.round(item.kcal)} kcal`}
            testID={`${testID}-item-${i}`}
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={12}
              paddingVertical={10}
              borderBottomWidth={1}
              borderColor="$border"
            >
              <View
                width={24}
                height={24}
                borderRadius={7}
                alignItems="center"
                justifyContent="center"
                backgroundColor={item.on ? "$primary" : "transparent"}
                borderWidth={item.on ? 0 : 1.5}
                borderColor="$text4"
              >
                {item.on ? <IconCheck size={14} color="#042F39" /> : null}
              </View>
              <View flex={1} gap={2}>
                <Text
                  fontFamily="$body"
                  fontSize={15}
                  fontWeight="500"
                  color={item.on ? "$text" : "$text4"}
                  textDecorationLine={item.on ? "none" : "line-through"}
                >
                  {item.name}
                </Text>
                <Text fontFamily="$body" fontSize={12} color="$text3">
                  {item.serving}
                </Text>
              </View>
              <Text
                fontFamily="$mono"
                fontSize={14}
                fontWeight="600"
                color={item.on ? "$text" : "$text4"}
                textDecorationLine={item.on ? "none" : "line-through"}
              >
                {Math.round(item.kcal)}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={p.onOpenLogTo}
        accessibilityRole="button"
        accessibilityLabel={`Log to ${p.logToName}. Change meal`}
        testID={`${testID}-log-to`}
      >
        <View
          marginTop={6}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingVertical={10}
          borderBottomWidth={1}
          borderColor="$border"
        >
          <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
            Log to
          </Text>
          <View
            height={40}
            minWidth={88}
            paddingHorizontal={14}
            borderRadius={12}
            backgroundColor="$surface2"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.08)"
            flexDirection="row"
            alignItems="center"
            justifyContent="flex-end"
            gap={6}
          >
            <Text
              fontFamily="$body"
              fontSize={15}
              fontWeight="600"
              color="$text"
              testID={`${testID}-log-to-name`}
            >
              {p.logToName}
            </Text>
            <IconChevronD size={16} color="#8A8A98" />
          </View>
        </View>
      </Pressable>

      <AiCaveats
        dietaryPatterns={p.dietaryPatterns}
        serverPartialEnforcementOnly={p.serverPartialEnforcementOnly}
        testID={`${testID}-caveat`}
      />

      <BottomSheet
        visible={p.logToOpen}
        onClose={p.onCloseLogTo}
        height="content"
        testID={`${testID}-log-to-sheet`}
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="Log to">
          <SheetTitle>Log to</SheetTitle>
          {p.logToMeals.map((meal) => {
            const on = meal.id === p.logToSelectedId;
            return (
              <Pressable
                key={meal.id}
                onPress={() => p.onPickLogTo(meal.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                testID={`${testID}-log-to-${meal.id}`}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  minHeight={48}
                  borderBottomWidth={1}
                  borderColor="$border"
                >
                  <Text
                    fontFamily="$body"
                    fontSize={15}
                    fontWeight="500"
                    color={on ? "$primary" : "$text"}
                  >
                    {meal.name}
                  </Text>
                  {on ? <IconCheck size={18} color="#22D3EE" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </MealprintPage>
  );
}
