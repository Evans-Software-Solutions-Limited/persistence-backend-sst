import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import {
  IconBack,
  IconCheck,
  IconDumbbell,
  IconUsers,
} from "@/ui/components/icons";
import type {
  CoachClientBand,
  OnboardingIntentKey,
  OnboardingPath,
} from "@/domain/models/onboarding";

type IntentOption = {
  intent: OnboardingIntentKey;
  tier: string;
  title: string;
  body: string;
};

export const NUTRITION_ONBOARDING_OPTIONS: readonly IntentOption[] = [
  {
    intent: "nutrition_barcode",
    tier: "Free",
    title: "Calories and barcodes",
    body: "Set a calorie goal, track what you eat, and scan barcodes.",
  },
  {
    intent: "nutrition_photo_estimate",
    tier: "Premium",
    title: "Log from a photo",
    body: "Photo calorie estimation you review before it saves. Includes everything in Free.",
  },
  {
    intent: "nutrition_mealprint",
    tier: "Premium+",
    title: "Mealprint meal suggestions",
    body: "Mealprint suggests meals around your calorie targets and preferences. Includes everything in Premium.",
  },
];

export const TRAINING_ONBOARDING_OPTIONS: readonly IntentOption[] = [
  {
    intent: "training_three_workouts",
    tier: "Free",
    title: "Up to 3 custom workouts",
    body: "Build and log up to three of your own workouts.",
  },
  {
    intent: "training_unlimited_workouts",
    tier: "Premium",
    title: "Unlimited workouts and history",
    body: "No cap on workouts, and your full training history. Includes everything in Free.",
  },
  {
    intent: "training_loadout",
    tier: "Premium+",
    title: "Loadout equipment-aware training",
    body: "Set up your gym once and Loadout adapts workouts to the equipment you have.",
  },
];

function StickyActions({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      paddingHorizontal={20}
      paddingTop={12}
      paddingBottom={insets.bottom + 12}
      borderTopWidth={1}
      borderColor="$border"
      backgroundColor="$bg"
      gap={8}
    >
      {children}
    </View>
  );
}

export function OnboardingWelcomePresenter({
  onContinue,
  onSkip,
}: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const steps = [
    ["Your profile", "Name, date of birth and the units you use"],
    ["How you'll use it", "Training for yourself, or coaching others"],
    ["Your daily habits", "Water, gym, steps, sleep and calories"],
    ["Nutrition and training", "How much you want the app to do for you"],
    ["Your plan", "We'll recommend one based on your answers"],
  ] as const;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="onboarding-welcome"
    >
      <View
        minHeight={48}
        paddingHorizontal={16}
        flexDirection="row"
        alignItems="center"
        justifyContent="flex-end"
      >
        <Btn
          variant="ghost"
          tone="primary"
          size="md"
          onPress={onSkip}
          testID="onboarding-welcome-skip"
        >
          Skip setup
        </Btn>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 16 }}>
        <View alignItems="center" marginTop={16} marginBottom={20}>
          <Image
            source={require("../../../assets/icons/splash-icon-dark.png")}
            style={{ width: 96, height: 96 }}
            contentFit="contain"
            accessibilityLabel="Persistence logo"
          />
        </View>
        <Text
          textAlign="center"
          color="$primary"
          fontSize={11}
          fontWeight="700"
          letterSpacing={1.6}
          textTransform="uppercase"
        >
          Welcome to Persistence
        </Text>
        <Text
          fontFamily="$display"
          fontSize={32}
          fontWeight="800"
          letterSpacing={-1}
          lineHeight={38}
          textAlign="center"
          color="$text"
          marginTop={8}
        >
          Let&apos;s get you started
        </Text>
        <Text
          fontFamily="$body"
          fontSize={14}
          lineHeight={21}
          textAlign="center"
          color="$text2"
          marginTop={10}
        >
          Five short steps, about three minutes. You can change any of it later.
        </Text>
        <View marginTop={24} gap={12}>
          {steps.map(([title, description], index) => (
            <View
              key={title}
              flexDirection="row"
              gap={12}
              alignItems="flex-start"
            >
              <View
                width={22}
                height={22}
                borderRadius={6}
                backgroundColor="$surface3"
                alignItems="center"
                justifyContent="center"
              >
                <Text
                  fontFamily="$mono"
                  fontSize={12}
                  fontWeight="700"
                  color="$text2"
                >
                  {index + 1}
                </Text>
              </View>
              <View flex={1}>
                <Text
                  fontFamily="$display"
                  fontSize={14.5}
                  fontWeight="600"
                  color="$text"
                >
                  {title}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={12.5}
                  color="$text3"
                  marginTop={1}
                >
                  {description}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <StickyActions>
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onContinue}
          testID="onboarding-welcome-continue"
        >
          Continue
        </Btn>
      </StickyActions>
    </View>
  );
}

export function OnboardingRolePresenter({
  path,
  band,
  onPathChange,
  onBandChange,
  onBack,
  onContinue,
  onSkip,
}: {
  path: OnboardingPath | null;
  band: CoachClientBand | null;
  onPathChange: (path: OnboardingPath) => void;
  onBandChange: (band: CoachClientBand) => void;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tile = (value: OnboardingPath, title: string, body: string) => {
    const selected = path === value;
    const coach = value === "coach";
    return (
      <Pressable
        onPress={() => onPathChange(value)}
        accessibilityRole="radio"
        accessibilityLabel={title}
        accessibilityState={{ selected, checked: selected }}
        testID={`onboarding-role-${value}`}
      >
        <View
          padding={18}
          borderRadius={16}
          borderWidth={selected ? 2 : 1}
          borderColor={
            selected ? (coach ? "$accentTrainer" : "$primary") : "$border"
          }
          backgroundColor="$surface2"
          flexDirection="row"
          gap={12}
        >
          <View
            width={40}
            height={40}
            borderRadius={12}
            backgroundColor={
              selected
                ? coach
                  ? "$accentTrainerDim"
                  : "$primaryDim"
                : "$surface3"
            }
            alignItems="center"
            justifyContent="center"
          >
            {coach ? <IconUsers size={20} /> : <IconDumbbell size={20} />}
          </View>
          <View flex={1}>
            <Text
              fontFamily="$display"
              fontSize={17}
              fontWeight="700"
              color="$text"
            >
              {title}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={12.5}
              lineHeight={18}
              color="$text2"
              marginTop={3}
            >
              {body}
            </Text>
          </View>
          {selected ? (
            <IconCheck size={20} color={coach ? "#A78BFA" : "#22D3EE"} />
          ) : null}
        </View>
      </Pressable>
    );
  };
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="onboarding-role"
    >
      <HeaderBar
        large
        titleNumberOfLines={2}
        eyebrow="Step 2 of 5"
        title="How will you use Persistence?"
        leading={
          <IconBtn
            icon={<IconBack size={18} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
        trailing={
          <Btn variant="ghost" tone="primary" size="md" onPress={onSkip}>
            Skip
          </Btn>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          gap: 12,
        }}
      >
        {tile(
          "athlete",
          "For myself",
          "Log your own training, nutrition and habits.",
        )}
        {tile(
          "coach",
          "Coach others",
          "Manage clients, build programmes and assign workouts. You can still track your own training.",
        )}
        {path === "coach" ? (
          <View
            padding={16}
            borderRadius={16}
            borderWidth={1}
            borderColor="$accentTrainer"
            backgroundColor="$surface"
          >
            <Text
              fontFamily="$display"
              fontSize={11}
              fontWeight="700"
              letterSpacing={1.4}
              textTransform="uppercase"
              color="$accentTrainer"
              marginBottom={10}
            >
              Expected active clients
            </Text>
            <View flexDirection="row" gap={8} accessibilityRole="radiogroup">
              {(["1_5", "6_15", "16_30"] as const).map((value) => {
                const selected = value === band;
                return (
                  <Pressable
                    key={value}
                    onPress={() => onBandChange(value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    testID={`onboarding-band-${value}`}
                    style={{ flex: 1 }}
                  >
                    <View
                      minHeight={44}
                      borderRadius={12}
                      borderWidth={1}
                      borderColor={selected ? "$accentTrainer" : "$border"}
                      backgroundColor={
                        selected ? "$accentTrainerDim" : "$surface2"
                      }
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Text
                        color={selected ? "$accentTrainer" : "$text2"}
                        fontWeight="700"
                      >
                        {value.replace("_", "–")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text fontSize={11.5} lineHeight={17} color="$text3" marginTop={10}>
              This only sets which coaching plan we recommend. It never grants
              permissions.
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <StickyActions>
        <Btn
          variant="filled"
          tone={path === "coach" ? "trainer" : "primary"}
          size="lg"
          full
          disabled={!path || (path === "coach" && !band)}
          onPress={onContinue}
          testID="onboarding-role-continue"
        >
          Continue
        </Btn>
      </StickyActions>
    </View>
  );
}

export function OnboardingIntentPresenter({
  kind,
  value,
  onChange,
  onBack,
  onContinue,
  onSkip,
}: {
  kind: "nutrition" | "training";
  value: OnboardingIntentKey;
  onChange: (intent: OnboardingIntentKey) => void;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const nutrition = kind === "nutrition";
  const options = nutrition
    ? NUTRITION_ONBOARDING_OPTIONS
    : TRAINING_ONBOARDING_OPTIONS;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={`onboarding-${kind}`}
    >
      <HeaderBar
        large
        titleNumberOfLines={nutrition ? 2 : 1}
        eyebrow={nutrition ? "Step 4 of 5" : "Step 5 of 5"}
        title={nutrition ? "Let's set up your nutrition" : "Train"}
        sub={
          nutrition
            ? "Pick the most you want the app to do. You can change plan any time."
            : "Pick the most you want for your training."
        }
        leading={
          <IconBtn
            icon={<IconBack size={18} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
        trailing={
          <Btn variant="ghost" tone="primary" size="md" onPress={onSkip}>
            Skip
          </Btn>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          gap: 12,
        }}
        accessibilityRole="radiogroup"
      >
        {options.map((option) => {
          const selected = option.intent === value;
          return (
            <Pressable
              key={option.intent}
              onPress={() => onChange(option.intent)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              testID={`onboarding-intent-${option.intent}`}
            >
              <View
                padding={16}
                borderRadius={16}
                borderWidth={selected ? 2 : 1}
                borderColor={selected ? "$primary" : "$border"}
                backgroundColor="$surface2"
                flexDirection="row"
                gap={12}
              >
                <View
                  width={20}
                  height={20}
                  borderRadius={10}
                  borderWidth={2}
                  borderColor={selected ? "$primary" : "$border2"}
                  alignItems="center"
                  justifyContent="center"
                >
                  {selected ? (
                    <View
                      width={10}
                      height={10}
                      borderRadius={5}
                      backgroundColor="$primary"
                    />
                  ) : null}
                </View>
                <View flex={1}>
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={8}
                    flexWrap="wrap"
                  >
                    <Text
                      fontFamily="$display"
                      fontSize={16}
                      fontWeight="700"
                      color="$text"
                    >
                      {option.title}
                    </Text>
                    <View
                      borderRadius={999}
                      backgroundColor={
                        option.tier === "Premium+"
                          ? "$goldDim"
                          : option.tier === "Premium"
                            ? "$primaryDim"
                            : "$surface3"
                      }
                      paddingHorizontal={8}
                      paddingVertical={3}
                    >
                      <Text
                        fontSize={10}
                        fontWeight="700"
                        color={
                          option.tier === "Premium+"
                            ? "$gold"
                            : option.tier === "Premium"
                              ? "$primary"
                              : "$text3"
                        }
                      >
                        {option.tier}
                      </Text>
                    </View>
                  </View>
                  <Text
                    fontSize={12.5}
                    lineHeight={18}
                    color="$text2"
                    marginTop={4}
                  >
                    {option.body}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
        <Text
          fontSize={11.5}
          lineHeight={17}
          color="$text3"
          paddingHorizontal={4}
        >
          Pick the most you want — everything below it is included. This records
          preference only; it does not unlock a feature.
        </Text>
      </ScrollView>
      <StickyActions>
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onContinue}
          testID={`onboarding-${kind}-continue`}
        >
          Continue
        </Btn>
      </StickyActions>
    </View>
  );
}
