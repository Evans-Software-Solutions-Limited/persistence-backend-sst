import React from "react";
import {
  ScrollView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ADAPTIVE_SUITE_LABEL,
  annualSaving,
  ctaFor,
  monthlyEquivalent,
  SUBSCRIPTION_CATALOG,
  staticTierPricing,
  tiersFor,
  type BillingCadence,
  type CatalogTier,
  type CatalogTierId,
  type TierPricing,
} from "@persistence/subscription-catalog";
import type {
  BillingCycle,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { SubscriptionLegalFooter } from "@/ui/components/subscription/SubscriptionLegalFooter";
import { color } from "@/ui/theme/tokens";

type Role = "user" | "trainer";
export type SubscriptionRailScreen = "persona" | "plans" | "manage";

export interface IOSPurchaseFlowPresenterProps {
  tierPricing: Readonly<Partial<Record<CatalogTierId, TierPricing>>>;
  isLoading: boolean;
  errorMessage: string | null;
  isUnavailable: boolean;
  billingCycle: BillingCycle;
  currentTier: SubscriptionTierName;
  selectedRole: Role;
  purchasableTiers: ReadonlySet<SubscriptionTierName>;
  isTierTrialEligible: (tier: SubscriptionTierName) => boolean;
  tierTrialDays: (tier: SubscriptionTierName) => number | null;
  hasTrialEligibilityData: boolean;
  monthlyOnlyTiers: ReadonlySet<SubscriptionTierName>;
  subscriptionEndsAt: string | null;
  isCancelledButActive: boolean;
  currentTierDisplayName: string;
  isProcessing: boolean;
  isRestoring: boolean;
  screen?: SubscriptionRailScreen;
  onBillingCycleChange: (cycle: BillingCycle) => void;
  onTierSelect: (tier: SubscriptionTierName) => void;
  onRoleChange: (role: Role) => void;
  onPersonaSelect?: (role: Role) => void;
  onChangePlan?: () => void;
  onContinueFree?: () => void;
  onBack: () => void;
  onRetry: () => void;
  onRestore: () => void;
  onManageInAppStore: () => void;
}

function formatGbpValue(value: number): string {
  if (value === 0) return "£0";
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })}`;
}

/** The only mobile component allowed to print a resolved subscription price. */
export function Price({
  tier,
  pricing = staticTierPricing(tier),
  cadence,
  compact = false,
  monthlyEquivalentOnly = false,
}: {
  tier: CatalogTier;
  pricing?: TierPricing;
  cadence: BillingCadence;
  compact?: boolean;
  monthlyEquivalentOnly?: boolean;
}) {
  const annual = cadence === "annual" && pricing.annual !== null;
  const value = monthlyEquivalentOnly
    ? monthlyEquivalent(pricing)
    : annual
      ? pricing.annual
      : pricing.monthly;
  const provisional = annual ? tier.provisionalAnnual : tier.provisionalMonthly;
  if (value === null) return null;

  return (
    <View style={styles.priceRow}>
      <Text
        style={[
          styles.price,
          compact && styles.priceCompact,
          monthlyEquivalentOnly && styles.equivalentPrice,
          provisional && styles.priceProvisional,
        ]}
        accessibilityHint={provisional ? "Provisional price" : undefined}
      >
        {monthlyEquivalentOnly
          ? (pricing.annualMonthlyEquivalentLabel ??
            formatGbpValue(Number(value.toFixed(2))))
          : annual
            ? (pricing.annualLabel ?? formatGbpValue(value))
            : (pricing.monthlyLabel ?? formatGbpValue(value))}
        {provisional ? "*" : ""}
      </Text>
      {value !== 0 && (
        <Text
          style={[
            styles.priceUnit,
            monthlyEquivalentOnly && styles.equivalentUnit,
          ]}
        >
          {annual && !monthlyEquivalentOnly ? "/yr" : "/mo"}
        </Text>
      )}
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.headerContainer}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack}
        testID="ios-purchase-back"
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={22} color={color.$text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function PersonaChooser({
  onSelect,
  onBack,
  onRestore,
  restoreDisabled,
  isRestoring,
}: {
  onSelect: (role: Role) => void;
  onBack: () => void;
  onRestore: () => void;
  restoreDisabled: boolean;
  isRestoring: boolean;
}) {
  const choices = [
    {
      id: "self",
      title: "I train myself",
      description: "Personal training, nutrition and progress tracking.",
      icon: "person-outline" as const,
      role: "user" as const,
    },
    {
      id: "coach",
      title: "I coach others",
      description: "Manage clients and build programmes for them.",
      icon: "people-outline" as const,
      role: "trainer" as const,
    },
    {
      id: "both",
      title: "Both",
      description: "Coach clients and train yourself on one coach plan.",
      icon: "sparkles-outline" as const,
      role: "trainer" as const,
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea} testID="subscription-persona-chooser">
      <StatusBar barStyle="light-content" backgroundColor={color.$bg} />
      <Header title="Welcome" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.personaContent}>
        <Text style={styles.eyebrow}>WELCOME TO PERSISTENCE</Text>
        <Text style={styles.personaTitle}>How will you use Persistence?</Text>
        <Text style={styles.personaSubtitle}>
          Your account carries one subscription. This sets your starting point,
          and you can switch later.
        </Text>

        <View style={styles.personaChoices}>
          {choices.map((choice) => (
            <TouchableOpacity
              key={choice.id}
              style={[
                styles.personaChoice,
                choice.id === "both" && styles.personaChoiceBoth,
              ]}
              onPress={() => onSelect(choice.role)}
              testID={`persona-${choice.id}`}
            >
              <View
                style={[
                  styles.personaIcon,
                  choice.role === "trainer" && styles.personaIconTrainer,
                ]}
              >
                <Ionicons
                  name={choice.icon}
                  size={23}
                  color={
                    choice.role === "trainer"
                      ? color.$accentTrainerBright
                      : color.$primaryBright
                  }
                />
              </View>
              <View style={styles.personaChoiceText}>
                <Text style={styles.personaChoiceTitle}>{choice.title}</Text>
                <Text style={styles.personaChoiceDescription}>
                  {choice.description}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={color.$text4} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.infoCard}>
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={color.$text3}
          />
          <Text style={styles.infoText}>
            Coaching tools live on coach plans. Choosing Both is not a second
            subscription: it is one coach plan that also powers your own
            training with {ADAPTIVE_SUITE_LABEL}.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.restoreButton}
          onPress={onRestore}
          disabled={restoreDisabled}
          testID="ios-purchase-restore"
        >
          <Text style={styles.restoreButtonText}>
            {isRestoring ? "Restoring..." : "Restore Purchases"}
          </Text>
        </TouchableOpacity>
        <SubscriptionLegalFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

function CadenceToggle({
  value,
  onChange,
}: {
  value: BillingCycle;
  onChange: (value: BillingCycle) => void;
}) {
  return (
    <View style={styles.cadenceToggle} accessibilityRole="tablist">
      {(["monthly", "yearly"] as const).map((cadence) => (
        <TouchableOpacity
          key={cadence}
          style={[
            styles.cadenceButton,
            value === cadence && styles.cadenceButtonActive,
          ]}
          onPress={() => onChange(cadence)}
          testID={cadence === "yearly" ? "billing-cycle-toggle" : undefined}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === cadence }}
        >
          <Text
            style={[
              styles.cadenceText,
              value === cadence && styles.cadenceTextActive,
            ]}
          >
            {cadence === "monthly" ? "Monthly" : "Annual"}
          </Text>
          {cadence === "yearly" && <Text style={styles.saveText}>save</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SuiteLine({ included }: { included: boolean }) {
  return (
    <View style={styles.suiteLine}>
      <Ionicons
        name={included ? "sparkles-outline" : "close"}
        size={14}
        color={included ? color.$gold : color.$text4}
      />
      <Text style={included ? styles.suiteIncluded : styles.suiteExcluded}>
        {included
          ? `${ADAPTIVE_SUITE_LABEL} included`
          : "Adaptive suite not included"}
      </Text>
    </View>
  );
}

function PaidCta({
  tier,
  enabled,
  disabled,
  onPress,
}: {
  tier: CatalogTier;
  enabled: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const cta = ctaFor(tier, { iapAvailable: enabled });
  if (tier.id === "free") return null;
  if (cta.enabled) {
    return (
      <TouchableOpacity
        style={[styles.comingSoon, styles.purchaseCta]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        testID={`subscription-card-${tier.id}-subscribe`}
      >
        <Text style={styles.purchaseCtaText}>{cta.label}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View
      style={styles.comingSoon}
      accessibilityRole="text"
      accessibilityLabel={`${tier.name}: ${cta.label}`}
      testID={`subscription-card-${tier.id}-coming-soon`}
    >
      <Ionicons name="time-outline" size={16} color={color.$text4} />
      <Text style={styles.comingSoonText}>{cta.label}</Text>
    </View>
  );
}

function TierCard({
  tier,
  pricing,
  cadence,
  trainer,
  onContinueFree,
  purchaseEnabled,
  purchaseDisabled,
  onTierSelect,
  trialDays,
  showTrial,
}: {
  tier: CatalogTier;
  pricing: TierPricing;
  cadence: BillingCadence;
  trainer: boolean;
  onContinueFree?: () => void;
  purchaseEnabled: boolean;
  purchaseDisabled: boolean;
  onTierSelect: () => void;
  trialDays: number | null;
  showTrial: boolean;
}) {
  const saving = annualSaving(pricing);
  const equivalent = monthlyEquivalent(pricing);
  const annual = cadence === "annual" && pricing.annual !== null;

  return (
    <View
      style={[
        styles.tierCard,
        tier.highlight && styles.tierCardHighlight,
        trainer && styles.tierCardTrainer,
      ]}
      testID={
        trainer
          ? `trainer-subscription-card-${tier.id}`
          : `subscription-card-${tier.id}`
      }
    >
      {tier.highlight && (
        <View style={styles.recommendedPill}>
          <Ionicons name="sparkles" size={10} color={color.$goldInk} />
          <Text style={styles.recommendedText}>LOADOUT + MEALPRINT</Text>
        </View>
      )}
      <View style={styles.tierHeader}>
        <View style={styles.tierTitleWrap}>
          <Text style={styles.tierName}>{tier.name}</Text>
          <Text style={styles.tierTagline}>{tier.tagline}</Text>
        </View>
        <View style={styles.tierPriceWrap}>
          <Price tier={tier} pricing={pricing} cadence={cadence} compact />
          {annual && equivalent !== null && (
            <View style={styles.equivalentRow}>
              <Price
                tier={tier}
                pricing={pricing}
                cadence="annual"
                compact
                monthlyEquivalentOnly
              />
              {saving ? (
                <Text style={styles.equivalentText}>· save {saving}%</Text>
              ) : null}
            </View>
          )}
        </View>
      </View>

      {tier.clients !== null && (
        <View style={styles.clientRow}>
          <View style={styles.clientBar}>
            <View
              style={[
                styles.clientBarFill,
                {
                  width: `${
                    typeof tier.clients === "number"
                      ? Math.min(100, (tier.clients / 30) * 100)
                      : 100
                  }%`,
                },
              ]}
            />
          </View>
          <Text style={styles.clientText}>{tier.clients} clients</Text>
        </View>
      )}

      <SuiteLine included={tier.suite} />
      <View style={styles.features}>
        {tier.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons
              name="checkmark"
              size={15}
              color={trainer ? color.$accentTrainer : color.$primary}
            />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>

      {showTrial && trialDays !== null && (
        <View style={styles.trialBanner} testID={`trial-banner-${tier.id}`}>
          <Ionicons name="gift-outline" size={15} color={color.$primary} />
          <Text style={styles.trialBannerText}>{trialDays}-day free trial</Text>
        </View>
      )}

      {tier.id === "free" ? (
        <TouchableOpacity
          style={styles.continueFree}
          onPress={onContinueFree}
          testID="subscription-card-free-continue"
        >
          <Text style={styles.continueFreeText}>Continue free</Text>
        </TouchableOpacity>
      ) : (
        <PaidCta
          tier={tier}
          enabled={purchaseEnabled}
          disabled={purchaseDisabled}
          onPress={onTierSelect}
        />
      )}
    </View>
  );
}

function PlansScreen(props: IOSPurchaseFlowPresenterProps) {
  const trainer = props.selectedRole === "trainer";
  const cadence: BillingCadence =
    props.billingCycle === "yearly" ? "annual" : "monthly";
  const tiers = tiersFor(trainer ? "coach" : "consumer");
  const hasProvisional = tiers.some((tier) =>
    cadence === "annual" ? tier.provisionalAnnual : tier.provisionalMonthly,
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={color.$bg} />
      <Header
        title={trainer ? "Coach plans" : "Choose your plan"}
        onBack={props.onBack}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {props.isUnavailable && (
          <View style={styles.noticeCard} testID="ios-purchase-unavailable">
            <Text style={styles.noticeText}>
              In-app purchases are coming soon. You can compare plans now.
            </Text>
          </View>
        )}

        <View style={styles.roleToggleContainer}>
          <TouchableOpacity
            style={[
              styles.roleToggleButton,
              !trainer && styles.roleToggleButtonActive,
            ]}
            onPress={() => props.onRoleChange("user")}
            testID="role-toggle-user"
          >
            <Text
              style={[
                styles.roleToggleText,
                !trainer && styles.roleToggleTextActive,
              ]}
            >
              Individuals
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleToggleButton,
              trainer && styles.roleToggleButtonActiveTrainer,
            ]}
            onPress={() => props.onRoleChange("trainer")}
            testID="role-toggle-trainer"
          >
            <Text
              style={[
                styles.roleToggleText,
                trainer && styles.roleToggleTextActive,
              ]}
            >
              Coaches
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cadenceWrap}>
          <CadenceToggle
            value={props.billingCycle}
            onChange={props.onBillingCycleChange}
          />
        </View>

        {trainer && (
          <View style={styles.coachExplainer}>
            <View style={styles.coachExplainerColumn}>
              <Ionicons
                name="people-outline"
                size={17}
                color={color.$accentTrainer}
              />
              <Text style={styles.coachExplainerTitle}>CLIENT CAPACITY</Text>
              <Text style={styles.coachExplainerText}>5 → 15 → 30</Text>
            </View>
            <View style={styles.coachExplainerColumn}>
              <Ionicons name="sparkles-outline" size={17} color={color.$gold} />
              <Text style={styles.coachExplainerTitle}>ADAPTIVE SUITE</Text>
              <Text style={styles.coachExplainerText}>
                Optional only at entry
              </Text>
            </View>
          </View>
        )}

        <View style={styles.tierCards}>
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              pricing={props.tierPricing[tier.id] ?? staticTierPricing(tier)}
              cadence={cadence}
              trainer={trainer}
              onContinueFree={props.onContinueFree}
              purchaseEnabled={props.purchasableTiers.has(
                tier.id as SubscriptionTierName,
              )}
              purchaseDisabled={props.isProcessing || props.isRestoring}
              onTierSelect={() =>
                props.onTierSelect(tier.id as SubscriptionTierName)
              }
              trialDays={props.tierTrialDays(tier.id as SubscriptionTierName)}
              showTrial={
                props.hasTrialEligibilityData &&
                props.currentTier !== tier.id &&
                props.isTierTrialEligible(tier.id as SubscriptionTierName)
              }
            />
          ))}
        </View>

        {hasProvisional && (
          <Text style={styles.provisionalFootnote}>* provisional pricing</Text>
        )}
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={props.onRestore}
          disabled={props.isProcessing || props.isRestoring}
          testID="ios-purchase-restore"
        >
          <Text style={styles.restoreButtonText}>
            {props.isRestoring ? "Restoring..." : "Restore Purchases"}
          </Text>
        </TouchableOpacity>
        <SubscriptionLegalFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

function ManageScreen(props: IOSPurchaseFlowPresenterProps) {
  const tier = SUBSCRIPTION_CATALOG.find(
    (candidate) => candidate.id === (props.currentTier as CatalogTierId),
  );
  const cadence: BillingCadence =
    props.billingCycle === "yearly" ? "annual" : "monthly";
  const renewal = props.subscriptionEndsAt
    ? new Date(props.subscriptionEndsAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <SafeAreaView style={styles.safeArea} testID="subscription-manage-screen">
      <StatusBar barStyle="light-content" backgroundColor={color.$bg} />
      <Header title="Subscription" onBack={props.onBack} />
      <ScrollView contentContainerStyle={styles.manageContent}>
        <View style={styles.manageHero}>
          <View style={styles.manageHeroTop}>
            <Text style={styles.eyebrow}>YOUR PLAN</Text>
            <Text style={styles.activePill}>
              {props.isCancelledButActive ? "CANCELLED" : "ACTIVE"}
            </Text>
          </View>
          <View style={styles.managePlanRow}>
            <View>
              <Text style={styles.managePlanName}>
                {tier?.name ?? props.currentTierDisplayName}
              </Text>
              {tier && <SuiteLine included={tier.suite} />}
            </View>
            {tier && (
              <View style={styles.tierPriceWrap}>
                <Text style={styles.manageCadence}>
                  {cadence === "annual" ? "Annual" : "Monthly"}
                </Text>
                {renewal && (
                  <Text style={styles.equivalentText}>
                    {props.isCancelledButActive ? "ends" : "renews"} {renewal}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        <View style={styles.manageActions}>
          <TouchableOpacity
            style={styles.manageRow}
            onPress={props.onChangePlan}
            testID="subscription-change-plan"
          >
            <Ionicons
              name="swap-horizontal-outline"
              size={19}
              color={color.$text3}
            />
            <Text style={styles.manageRowLabel}>Change plan</Text>
            <Ionicons name="chevron-forward" size={17} color={color.$text4} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.manageRow}
            onPress={props.onManageInAppStore}
            testID="ios-purchase-manage"
          >
            <Ionicons
              name={
                Platform.OS === "android"
                  ? "logo-google-playstore"
                  : "logo-apple"
              }
              size={19}
              color={color.$text3}
            />
            <Text style={styles.manageRowLabel}>
              Payment, receipts and cancellation
            </Text>
            <Text style={styles.manageRowDetail}>
              {Platform.OS === "android" ? "Google Play" : "App Store"}
            </Text>
          </TouchableOpacity>
          <View style={styles.manageRow}>
            <Ionicons name="calendar-outline" size={19} color={color.$text3} />
            <Text style={styles.manageRowLabel}>Billing period</Text>
            <Text style={styles.manageRowDetail}>
              {cadence === "annual" ? "Annual" : "Monthly"}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function IOSPurchaseFlowPresenter(props: IOSPurchaseFlowPresenterProps) {
  if (props.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} testID="ios-purchase-loading">
        <View style={styles.centeredContainer}>
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>Loading plans...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (props.errorMessage) {
    return (
      <SafeAreaView style={styles.safeArea} testID="ios-purchase-error">
        <View style={styles.centeredContainer}>
          <Ionicons name="warning" size={48} color={color.$error} />
          <Text style={styles.errorTitle}>Couldn&apos;t load plans</Text>
          <Text style={styles.errorMessage}>{props.errorMessage}</Text>
          <TouchableOpacity
            style={styles.continueFree}
            onPress={props.onRetry}
            testID="ios-purchase-retry"
          >
            <Text style={styles.continueFreeText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (props.screen === "manage") return <ManageScreen {...props} />;
  if (props.screen === "persona") {
    return (
      <PersonaChooser
        onSelect={props.onPersonaSelect ?? props.onRoleChange}
        onBack={props.onBack}
        onRestore={props.onRestore}
        restoreDisabled={props.isProcessing || props.isRestoring}
        isRestoring={props.isRestoring}
      />
    );
  }
  return <PlansScreen {...props} />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: color.$bg },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  loadingText: { color: color.$text, fontSize: 16, marginTop: 16 },
  errorTitle: { color: color.$text, fontSize: 20, fontWeight: "700" },
  errorMessage: { color: color.$text2, fontSize: 14, textAlign: "center" },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: color.$surface,
  },
  headerTitle: {
    flex: 1,
    color: color.$text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  headerSpacer: { width: 40 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 28 },
  personaContent: { padding: 22, paddingBottom: 48 },
  eyebrow: {
    color: color.$primaryBright,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  personaTitle: {
    marginTop: 14,
    color: color.$text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -1.2,
  },
  personaSubtitle: {
    marginTop: 12,
    color: color.$text2,
    fontSize: 14,
    lineHeight: 21,
  },
  personaChoices: { marginTop: 25, gap: 12 },
  personaChoice: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: color.$border2,
    borderRadius: 18,
    backgroundColor: color.$surface,
  },
  personaChoiceBoth: {
    borderColor: color.$accentTrainerDim,
    backgroundColor: color.$accentTrainerDim,
  },
  personaIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: color.$primaryDim,
  },
  personaIconTrainer: { backgroundColor: color.$accentTrainerDim },
  personaChoiceText: { flex: 1 },
  personaChoiceTitle: { color: color.$text, fontSize: 17, fontWeight: "700" },
  personaChoiceDescription: {
    marginTop: 4,
    color: color.$text3,
    fontSize: 12.5,
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 14,
    backgroundColor: color.$surface,
  },
  infoText: { flex: 1, color: color.$text2, fontSize: 12, lineHeight: 18 },
  roleToggleContainer: {
    flexDirection: "row",
    gap: 4,
    marginTop: 8,
    padding: 4,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 13,
    backgroundColor: color.$surface2,
  },
  roleToggleButton: {
    flex: 1,
    minHeight: 39,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  roleToggleButtonActive: { backgroundColor: color.$primaryDim },
  roleToggleButtonActiveTrainer: { backgroundColor: color.$accentTrainerDim },
  roleToggleText: { color: color.$text3, fontSize: 13, fontWeight: "600" },
  roleToggleTextActive: { color: color.$text },
  cadenceWrap: { alignItems: "center", marginVertical: 16 },
  cadenceToggle: {
    flexDirection: "row",
    padding: 4,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 12,
    backgroundColor: color.$surface2,
  },
  cadenceButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderRadius: 9,
  },
  cadenceButtonActive: { backgroundColor: color.$surface4 },
  cadenceText: { color: color.$text3, fontSize: 13, fontWeight: "600" },
  cadenceTextActive: { color: color.$text },
  saveText: { marginLeft: 6, color: color.$success, fontSize: 10 },
  noticeCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: color.$primaryDim,
  },
  noticeText: { color: color.$text2, fontSize: 12, textAlign: "center" },
  coachExplainer: { flexDirection: "row", gap: 10, marginBottom: 14 },
  coachExplainerColumn: {
    flex: 1,
    minHeight: 92,
    padding: 12,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 13,
    backgroundColor: color.$surface,
  },
  coachExplainerTitle: {
    marginTop: 8,
    color: color.$text3,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  coachExplainerText: { marginTop: 5, color: color.$text2, fontSize: 11.5 },
  tierCards: { gap: 13 },
  tierCard: {
    position: "relative",
    padding: 16,
    borderWidth: 1.5,
    borderColor: color.$border2,
    borderRadius: 18,
    backgroundColor: color.$surface,
  },
  tierCardHighlight: {
    borderColor: color.$goldDim,
    backgroundColor: color.$goldDim,
  },
  tierCardTrainer: { borderColor: color.$accentTrainerDim },
  recommendedPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: -25,
    marginBottom: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: color.$gold,
  },
  recommendedText: { color: color.$goldInk, fontSize: 8.5, fontWeight: "800" },
  tierHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  tierTitleWrap: { flex: 1 },
  tierName: { color: color.$text, fontSize: 18, fontWeight: "700" },
  tierTagline: {
    marginTop: 3,
    color: color.$text3,
    fontSize: 11.5,
    lineHeight: 16,
  },
  tierPriceWrap: { alignItems: "flex-end" },
  priceRow: { flexDirection: "row", alignItems: "baseline" },
  price: {
    color: color.$text,
    fontSize: 31,
    fontWeight: "800",
    letterSpacing: -1,
  },
  priceCompact: { fontSize: 22 },
  priceProvisional: {
    textDecorationLine: "underline",
    textDecorationStyle: "dashed",
  },
  priceUnit: { marginLeft: 3, color: color.$text3, fontSize: 10.5 },
  equivalentRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  equivalentPrice: { color: color.$text4, fontSize: 9.5, letterSpacing: 0 },
  equivalentUnit: { color: color.$text4, fontSize: 9.5 },
  equivalentText: { marginTop: 3, color: color.$text4, fontSize: 9.5 },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  clientBar: {
    width: 54,
    height: 5,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: color.$surface4,
  },
  clientBarFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: color.$accentTrainer,
  },
  clientText: { color: color.$text2, fontSize: 11, fontWeight: "600" },
  suiteLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 12,
  },
  suiteIncluded: {
    color: color.$goldBright,
    fontSize: 11.5,
    fontWeight: "600",
  },
  suiteExcluded: { color: color.$text3, fontSize: 11.5 },
  features: { gap: 7, marginTop: 13 },
  trialBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: color.$primaryDim,
  },
  trialBannerText: {
    color: color.$primary,
    fontSize: 12,
    fontWeight: "700",
  },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  featureText: { flex: 1, color: color.$text2, fontSize: 12, lineHeight: 17 },
  comingSoon: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 16,
    borderWidth: 1,
    borderColor: color.$border2,
    borderRadius: 13,
    backgroundColor: color.$surface3,
  },
  comingSoonText: { color: color.$text3, fontSize: 14, fontWeight: "700" },
  purchaseCta: {
    borderColor: color.$primary,
    backgroundColor: color.$primary,
  },
  purchaseCtaText: {
    color: color.$primaryInk,
    fontSize: 14,
    fontWeight: "700",
  },
  continueFree: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingHorizontal: 24,
    borderRadius: 13,
    backgroundColor: color.$primary,
  },
  continueFreeText: {
    color: color.$primaryInk,
    fontSize: 14,
    fontWeight: "700",
  },
  provisionalFootnote: {
    marginTop: 12,
    color: color.$text4,
    fontSize: 10,
    textAlign: "center",
  },
  restoreButton: { alignItems: "center", padding: 16, marginTop: 10 },
  restoreButtonText: { color: color.$primary, fontSize: 13, fontWeight: "600" },
  manageContent: { padding: 18, paddingBottom: 40 },
  manageHero: {
    padding: 18,
    borderWidth: 1,
    borderColor: color.$goldDim,
    borderRadius: 18,
    backgroundColor: color.$goldDim,
  },
  manageHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: color.$successDim,
    color: color.$success,
    fontSize: 9,
    fontWeight: "700",
  },
  managePlanRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 13,
  },
  managePlanName: {
    color: color.$text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  manageCadence: {
    color: color.$text,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
  },
  manageActions: {
    overflow: "hidden",
    marginTop: 18,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 16,
    backgroundColor: color.$surface,
  },
  manageRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: color.$border,
  },
  manageRowLabel: {
    flex: 1,
    color: color.$text,
    fontSize: 13.5,
    fontWeight: "600",
  },
  manageRowDetail: { color: color.$text3, fontSize: 11 },
});
