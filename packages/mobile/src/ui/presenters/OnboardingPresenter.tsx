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
  IconWifiOff,
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

/**
 * Copy for the confirmation screen shown in place of plan recommendation /
 * selection when the user already carries a paid entitlement at the end of
 * onboarding (a founding-offer grant applied server-side, or an admin
 * grant). Centralised as data so the presenter has no ad-hoc inline strings.
 */
export const ACCOUNT_ONLY_CONFIRMATION_COPY = {
  eyebrow: "YOU'RE ALL SET",
  title: "Your access is ready",
  bodyWithExpiry: (tierDisplayName: string, expiresAtLabel: string) =>
    `Your ${tierDisplayName} access is active until ${expiresAtLabel}.`,
  bodyWithoutExpiry: (tierDisplayName: string) =>
    `Your ${tierDisplayName} access is active.`,
  continueLabel: "Continue",
} as const;

export const OFFLINE_PLANS_COPY = {
  eyebrow: "NO CONNECTION",
  title: "Plans need a connection",
  body:
    "We can't load subscription plans while you're offline. Finish setup and " +
    "the rest of your answers are saved on this device, then synced when you " +
    "reconnect.",
  hint: "You can pick a plan any time from Settings.",
  finishLabel: "Finish setup without a plan",
  retryLabel: "Try again",
} as const;

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

/**
 * Replaces the recommendation / subscription-selection page for a user who
 * already carries a paid entitlement (account-only mode) — a founding-offer
 * grant applied server-side, or an admin grant, resolved via
 * `useMySubscription` before this page can render. No plan is offered: the
 * user already has one.
 */
export function OnboardingAccountConfirmationPresenter({
  tierDisplayName,
  expiresAt,
  onContinue,
}: {
  tierDisplayName: string;
  expiresAt: string | null;
  onContinue: () => void;
}) {
  const insets = useSafeAreaInsets();
  const expiresAtLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="onboarding-account-confirmation"
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View alignItems="center" marginBottom={20}>
          <View
            width={64}
            height={64}
            borderRadius={32}
            backgroundColor="$primaryDim"
            alignItems="center"
            justifyContent="center"
          >
            <IconCheck size={32} color="#22D3EE" />
          </View>
        </View>
        <Text
          textAlign="center"
          color="$primary"
          fontSize={11}
          fontWeight="700"
          letterSpacing={1.6}
          textTransform="uppercase"
        >
          {ACCOUNT_ONLY_CONFIRMATION_COPY.eyebrow}
        </Text>
        <Text
          fontFamily="$display"
          fontSize={28}
          fontWeight="800"
          letterSpacing={-1}
          lineHeight={34}
          textAlign="center"
          color="$text"
          marginTop={8}
        >
          {ACCOUNT_ONLY_CONFIRMATION_COPY.title}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={14}
          lineHeight={21}
          textAlign="center"
          color="$text2"
          marginTop={10}
        >
          {expiresAtLabel
            ? ACCOUNT_ONLY_CONFIRMATION_COPY.bodyWithExpiry(
                tierDisplayName,
                expiresAtLabel,
              )
            : ACCOUNT_ONLY_CONFIRMATION_COPY.bodyWithoutExpiry(tierDisplayName)}
        </Text>
      </ScrollView>
      <StickyActions>
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onContinue}
          testID="onboarding-account-confirmation-continue"
        >
          {ACCOUNT_ONLY_CONFIRMATION_COPY.continueLabel}
        </Btn>
      </StickyActions>
    </View>
  );
}

/**
 * The plan picker's offline state — the one onboarding page that genuinely
 * cannot work without a network, since plans and entitlements are both
 * server-owned.
 *
 * Everything else in the journey is local-first, so this degrades rather than
 * blocking: finish setup now and choose a plan later, or reconnect and retry.
 * Brad's call, 2026-09-07 — the alternative was walling the whole account off
 * behind "temporarily unavailable".
 *
 * Deliberately NOT an ErrorState: nothing has gone wrong with the account, and
 * "Finish setup" is a real, complete outcome rather than a way out of a fault.
 */
export function OnboardingOfflinePlansPresenter({
  onFinish,
  onRetry,
  onBack,
}: {
  onFinish: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="onboarding-offline-plans"
    >
      <HeaderBar
        leading={
          <IconBtn
            icon={<IconBack size={18} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View alignItems="center" marginBottom={20}>
          <View
            width={64}
            height={64}
            borderRadius={32}
            backgroundColor="rgba(251,191,36,0.10)"
            alignItems="center"
            justifyContent="center"
          >
            <IconWifiOff size={32} color="#FBBF24" />
          </View>
        </View>
        <Text
          textAlign="center"
          color="$warning"
          fontSize={11}
          fontWeight="700"
          letterSpacing={1.6}
          textTransform="uppercase"
        >
          {OFFLINE_PLANS_COPY.eyebrow}
        </Text>
        <Text
          fontFamily="$display"
          fontSize={28}
          fontWeight="800"
          letterSpacing={-1}
          lineHeight={34}
          textAlign="center"
          color="$text"
          marginTop={8}
        >
          {OFFLINE_PLANS_COPY.title}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={14}
          lineHeight={21}
          textAlign="center"
          color="$text2"
          marginTop={10}
        >
          {OFFLINE_PLANS_COPY.body}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={13}
          lineHeight={20}
          textAlign="center"
          color="$text3"
          marginTop={12}
        >
          {OFFLINE_PLANS_COPY.hint}
        </Text>
      </ScrollView>
      <StickyActions>
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onFinish}
          testID="onboarding-offline-plans-finish"
        >
          {OFFLINE_PLANS_COPY.finishLabel}
        </Btn>
        <Btn
          variant="ghost"
          tone="primary"
          size="lg"
          full
          onPress={onRetry}
          testID="onboarding-offline-plans-retry"
        >
          {OFFLINE_PLANS_COPY.retryLabel}
        </Btn>
      </StickyActions>
    </View>
  );
}
