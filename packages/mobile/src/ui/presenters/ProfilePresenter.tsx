import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { ComingSoon } from "@/ui/components/ComingSoon";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { SubscriptionBadge } from "@/ui/components/subscription/SubscriptionBadge";
import { color } from "@/ui/theme/tokens";
import type {
  ProfilePageAchievement,
  ProfilePageSubscription,
  ProfilePageSubscriptionStatus,
  ProfilePageTrainerRef,
} from "@/domain/models/profilePage";
import type {
  SubscriptionStatus,
  SubscriptionTierName,
} from "@/domain/models/subscription";

/**
 * Pure presenter for the Profile tab. Layout, copy, and StyleSheet
 * ported 1:1 from `persistence-mobile/app/(tabs)/profile.tsx`. The
 * container owns all data + side effects; this presenter is
 * render-only.
 *
 * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md + the legacy
 *       profile.tsx (≈1170 lines, 10 sections).
 */

export type ProfilePresenterProps = {
  /** True when no cache is present AND a refresh is in flight. */
  isInitialLoading: boolean;
  /** True while a background refresh is in flight (cache visible). */
  isRefreshing: boolean;
  /** Non-blocking error from the last refresh attempt. */
  errorMessage: string | null;

  // Header
  displayName: string | null;
  /**
   * Tier + payment-status pair sourced from `useMySubscription` (typed
   * SubscriptionTierName + SubscriptionStatus enums). `null` while the
   * query hasn't resolved yet — the presenter omits the chip entirely
   * in that window rather than rendering a placeholder.
   *
   * Spec: specs/11-payments-subscriptions/design.md § Per-screen
   *       feature-gate integration > Wave 2 Progress / Health / Profile
   *       subset > "SubscriptionBadge reads useMySubscription directly".
   * Satisfies: requirements.md AC 10.3.
   */
  badge: {
    tier: SubscriptionTierName;
    paymentStatus: SubscriptionStatus;
  } | null;
  email: string | null;
  avatarUrl: string | null;
  /**
   * Increments on every successful avatar upload/remove. Threaded into the
   * `<Image>`'s `key` AND appended as a `?_cb=` query param so RN's
   * in-memory image cache (and any CDN edge layer) is bypassed on next
   * paint. Without this, the URL is stable per-user, so the old image
   * sticks visually until the user kills the app.
   */
  avatarCacheKey: number;
  /** Disables avatar tap while picker/resize/upload is in flight. */
  isAvatarWorking: boolean;
  userRoleLabel: string;

  // Subscription
  subscription: ProfilePageSubscription | null;

  // Stats
  isTrainer: boolean;
  workoutsCompleted: number;
  recentAchievements: readonly ProfilePageAchievement[];

  // Trainer relationships
  activeTrainers: readonly ProfilePageTrainerRef[];
  pendingTrainerRequests: readonly ProfilePageTrainerRef[];

  // Footer
  appVersion: string;
  isSigningOut: boolean;

  // Handlers
  onRefresh: () => void;
  onSelectProfilePicture: () => void;
  onManageSubscription: () => void;
  onUpgradeSubscription: () => void;
  onBecomeTrainer: () => void;
  onEditProfile: () => void;
  onHealthData: () => void;
  onNotifications: () => void;
  onNotificationPreferences: () => void;
  onSignOut: () => void;
  onHelpCenter: () => void;
  onContactSupport: () => void;
  onTermsOfService: () => void;
  onPrivacyPolicy: () => void;
};

function titleCaseTier(tier: string | null): string {
  if (tier === null || tier.trim().length === 0) return "Subscription";
  return tier
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSubscriptionBadge(status: ProfilePageSubscriptionStatus | null) {
  if (status === "active") {
    return (
      <View style={styles.subscriptionBadge}>
        <Text style={styles.subscriptionBadgeText}>Active</Text>
      </View>
    );
  }
  if (status === "trialing") {
    return (
      <View style={styles.subscriptionBadge}>
        <Text style={styles.subscriptionBadgeText}>Trial</Text>
      </View>
    );
  }
  if (status === "cancelled") {
    return (
      <View style={styles.subscriptionBadge}>
        <Text style={styles.subscriptionBadgeText}>Cancelled</Text>
      </View>
    );
  }
  return null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export function ProfilePresenter({
  isInitialLoading,
  isRefreshing,
  errorMessage,
  displayName,
  badge,
  email,
  avatarUrl,
  avatarCacheKey,
  isAvatarWorking,
  userRoleLabel,
  subscription,
  isTrainer,
  workoutsCompleted,
  recentAchievements,
  activeTrainers,
  pendingTrainerRequests,
  appVersion,
  isSigningOut,
  onRefresh,
  onSelectProfilePicture,
  onManageSubscription,
  onUpgradeSubscription,
  onBecomeTrainer,
  onEditProfile,
  onHealthData,
  onNotifications,
  onNotificationPreferences,
  onSignOut,
  onHelpCenter,
  onContactSupport,
  onTermsOfService,
  onPrivacyPolicy,
}: ProfilePresenterProps) {
  if (isInitialLoading) {
    return (
      <View style={styles.container} testID="profile-screen">
        <View style={styles.loadingContainer}>
          <PLogoDrawLoader />
        </View>
      </View>
    );
  }

  const isFreeUser = subscription?.isFreeTier ?? true;
  const tierTitle =
    subscription?.tierDisplayName ??
    titleCaseTier(subscription?.tierName ?? null);

  return (
    <View style={styles.container} testID="profile-screen">
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={color.$text2}
          />
        }
      >
        {/* 1. Header */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.profilePictureContainer}
            onPress={onSelectProfilePicture}
            disabled={isAvatarWorking}
            testID="profile-avatar-button"
            accessibilityRole="button"
            accessibilityLabel="Change profile picture"
          >
            <View style={styles.profilePictureWrapper}>
              {avatarUrl ? (
                <Image
                  key={`${avatarUrl}-${avatarCacheKey}`}
                  source={{
                    uri: `${avatarUrl}${
                      avatarUrl.includes("?") ? "&" : "?"
                    }_cb=${avatarCacheKey}`,
                  }}
                  style={styles.profilePicture}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                  testID="profile-avatar-image"
                />
              ) : (
                <View style={styles.profilePicturePlaceholder}>
                  <Ionicons name="person" size={32} color={color.$text2} />
                </View>
              )}
            </View>
            <View style={styles.editIconContainer}>
              {isAvatarWorking ? (
                <PLogoDrawLoader size={16} />
              ) : (
                <Ionicons name="camera" size={16} color={color.$text} />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.nameRow}>
            <Text style={styles.userName} testID="profile-name">
              {displayName ?? "User"}
            </Text>
            {badge && (
              <View
                style={styles.nameBadge}
                testID="profile-subscription-badge"
              >
                <SubscriptionBadge
                  tier={badge.tier}
                  paymentStatus={badge.paymentStatus}
                  compact
                />
              </View>
            )}
          </View>
          <Text style={styles.userEmail} testID="profile-email">
            {email ?? ""}
          </Text>
          <Text style={styles.userRole}>{userRoleLabel}</Text>
        </View>

        {errorMessage && (
          <View style={styles.errorBanner} testID="profile-error-banner">
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        )}

        {/* 2. Subscription */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Subscription</Text>
          <TouchableOpacity
            style={styles.subscriptionCard}
            onPress={isFreeUser ? onUpgradeSubscription : onManageSubscription}
            activeOpacity={0.7}
            testID="subscription-card"
          >
            <View style={styles.subscriptionHeader}>
              <Text style={styles.subscriptionTitle}>
                {isFreeUser ? "Free Tier" : tierTitle}
              </Text>
            </View>
            {isFreeUser ? (
              <>
                <Text style={styles.subscriptionSubtitle}>
                  Limit of 3 custom workouts.
                </Text>
                <View style={styles.subscriptionFooter}>
                  <Text style={styles.subscriptionFooterText}>
                    Upgrade to unlock premium features and unlimited workouts
                  </Text>
                  <Text style={styles.upgradeLink}>
                    Upgrade Now{" "}
                    <Ionicons
                      name="arrow-forward"
                      size={14}
                      color={color.$primary}
                    />
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.subscriptionSubtitle}>
                  {subscription?.isUnlimited ||
                  subscription?.workoutLimit === null
                    ? "Unlimited workouts"
                    : `${subscription?.workoutLimit ?? 0} workouts per month`}
                </Text>
                {subscription?.expiresAt && (
                  <Text style={styles.subscriptionDate}>
                    {subscription.cancelledAt
                      ? `Ends on ${formatDate(subscription.expiresAt)}`
                      : `Renews on ${formatDate(subscription.expiresAt)}`}
                  </Text>
                )}
                {getSubscriptionBadge(subscription?.status ?? null)}
                {subscription?.cancelledAt && subscription?.expiresAt && (
                  <View style={styles.subscriptionBadgeWarning}>
                    <Text style={styles.subscriptionBadgeWarningText}>
                      Cancelled
                      {(() => {
                        const endsAt = new Date(subscription.expiresAt);
                        const now = new Date();
                        const daysLeft = Math.ceil(
                          (endsAt.getTime() - now.getTime()) /
                            (1000 * 60 * 60 * 24),
                        );
                        return daysLeft > 0
                          ? ` • ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`
                          : "";
                      })()}
                    </Text>
                  </View>
                )}
                <View style={styles.subscriptionFooter}>
                  <Text style={styles.subscriptionFooterText}>
                    Tap to manage your subscription
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* 3. Trainer promo (non-trainer users only) */}
        {!isTrainer && (
          <View style={styles.section}>
            <View style={styles.trainerPromoBanner}>
              <View style={styles.trainerPromoContent}>
                <View style={styles.trainerPromoIconContainer}>
                  <Ionicons name="people" size={24} color={color.$primary} />
                </View>
                <View style={styles.trainerPromoTextContainer}>
                  <Text style={styles.trainerPromoTitle}>
                    Are you a Physio or Personal Trainer?
                  </Text>
                  <Text style={styles.trainerPromoDescription}>
                    Unlock client slots and manage your clients&apos; progress
                    with our trainer platform
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.trainerPromoButton}
                onPress={onBecomeTrainer}
                testID="become-trainer-button"
              >
                <Text style={styles.trainerPromoButtonText}>
                  Become a Trainer
                </Text>
                <Ionicons name="arrow-forward" size={18} color={color.$bg} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 4. Stats */}
        {isTrainer ? (
          <View style={styles.section} testID="trainer-stats-placeholder">
            <ComingSoon
              icon="people-outline"
              title="Trainer Stats"
              description="Roster overview lights up in M8."
            />
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Stats</Text>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber} testID="workouts-completed">
                  {workoutsCompleted}
                </Text>
                <Text style={styles.statLabel}>Workouts Completed</Text>
              </View>
            </View>
            {recentAchievements.length > 0 && (
              <View style={styles.achievementsContainer}>
                <Text style={styles.achievementsTitle}>
                  Recent Achievements
                </Text>
                <View style={styles.achievementsList}>
                  {recentAchievements.slice(0, 3).map((achievement) => (
                    <View
                      key={achievement.id}
                      style={styles.achievementCard}
                      testID={`achievement-${achievement.id}`}
                    >
                      <Text style={styles.achievementEmoji}>
                        {achievement.iconUrl ? "🏆" : "⭐"}
                      </Text>
                      <View style={styles.achievementInfo}>
                        <Text style={styles.achievementName}>
                          {achievement.name}
                        </Text>
                        <Text style={styles.achievementDescription}>
                          {achievement.description ?? ""}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* 5. Active trainers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Trainers</Text>
          {activeTrainers.length > 0 ? (
            <View style={styles.clientsList}>
              {activeTrainers.map((rel) => (
                <View
                  key={rel.id}
                  style={styles.clientCard}
                  testID={`active-trainer-${rel.id}`}
                >
                  {rel.trainer.avatarUrl ? (
                    <Image
                      source={{ uri: rel.trainer.avatarUrl }}
                      style={styles.clientAvatar}
                      contentFit="cover"
                      transition={200}
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={styles.clientAvatarPlaceholder}>
                      <Ionicons name="person" size={20} color={color.$text2} />
                    </View>
                  )}
                  <View style={styles.clientInfo}>
                    <Text style={styles.clientName}>
                      {rel.trainer.fullName ?? "Unknown Trainer"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState} testID="active-trainers-empty">
              <Ionicons name="fitness-outline" size={48} color={color.$text3} />
              <Text style={styles.emptyText}>No active trainers</Text>
              <Text style={styles.emptySubtext}>
                Connect with a trainer to get personalized workout guidance
              </Text>
            </View>
          )}
        </View>

        {/* 6. Pending trainer requests */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Trainer Requests</Text>
          <Text style={styles.sectionDescription}>
            Trainers requesting to connect with you
          </Text>
          {pendingTrainerRequests.length > 0 ? (
            <View style={styles.clientsList}>
              {pendingTrainerRequests.map((rel) => (
                <View
                  key={rel.id}
                  style={styles.clientCard}
                  testID={`pending-request-${rel.id}`}
                >
                  {rel.trainer.avatarUrl ? (
                    <Image
                      source={{ uri: rel.trainer.avatarUrl }}
                      style={styles.clientAvatar}
                      contentFit="cover"
                      transition={200}
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={styles.clientAvatarPlaceholder}>
                      <Ionicons name="person" size={20} color={color.$text2} />
                    </View>
                  )}
                  <View style={styles.clientInfo}>
                    <Text style={styles.clientName}>
                      {rel.trainer.fullName ?? "Unknown Trainer"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState} testID="pending-requests-empty">
              <Ionicons name="mail-outline" size={48} color={color.$text3} />
              <Text style={styles.emptyText}>No pending requests</Text>
              <Text style={styles.emptySubtext}>
                You&apos;ll see trainer connection requests here when
                they&apos;re sent
              </Text>
            </View>
          )}
        </View>

        {/* 7. Account menu */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onEditProfile}
            testID="menu-edit-profile"
          >
            <Text style={styles.menuText}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onHealthData}
            testID="menu-health-data"
          >
            <Text style={styles.menuText}>Health Data</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onNotifications}
            testID="menu-notifications"
          >
            <Text style={styles.menuText}>Notifications</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onNotificationPreferences}
            testID="menu-notification-preferences"
          >
            <Text style={styles.menuText}>Notification Preferences</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>
        </View>

        {/* 8. Support menu */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onHelpCenter}
            testID="menu-help-center"
          >
            <Text style={styles.menuText}>Help Center</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onContactSupport}
            testID="menu-contact-support"
          >
            <Text style={styles.menuText}>Contact Support</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onTermsOfService}
            testID="menu-terms"
          >
            <Text style={styles.menuText}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={onPrivacyPolicy}
            testID="menu-privacy"
          >
            <Text style={styles.menuText}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={20} color={color.$text2} />
          </TouchableOpacity>
        </View>

        {/* 9. Sign out */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[
              styles.signOutButton,
              isSigningOut && styles.signOutButtonDisabled,
            ]}
            onPress={onSignOut}
            disabled={isSigningOut}
            testID="sign-out-button"
          >
            <Text style={styles.signOutText}>
              {isSigningOut ? "Signing out…" : "Sign Out"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 10. App version */}
        <View style={styles.versionSection}>
          <Text style={styles.versionText} testID="app-version">
            Persistence v{appVersion}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 16,
  },
  sectionDescription: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginBottom: 16,
  },

  errorBanner: {
    marginBottom: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#DC2626" + "33",
    borderWidth: 1,
    borderColor: color.$error + "55",
  },
  errorBannerText: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$error,
    textAlign: "center",
  },

  // Profile Header
  profilePictureContainer: {
    alignSelf: "center",
    marginBottom: 16,
    position: "relative",
  },
  profilePictureWrapper: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: "hidden",
  },
  profilePicture: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: color.$surface,
  },
  profilePicturePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: color.$surface,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  editIconContainer: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: color.$bg,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 4,
  },
  nameBadge: {
    // SubscriptionBadge has its own background colour + padding; this
    // wrapper aligns the chip vertically with the display name without
    // forcing the chip to inherit the username's typographic colour.
  },
  userName: {
    fontSize: 24,
    fontWeight: "600" as const,
    lineHeight: 32,
    color: color.$text,
    textAlign: "center",
  },
  userEmail: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    textAlign: "center",
    color: color.$text2,
    marginBottom: 4,
  },
  userRole: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    textAlign: "center",
    color: color.$text2,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  statCard: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    flex: 1,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "600" as const,
    lineHeight: 32,
    color: color.$primary,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginTop: 4,
    textAlign: "center",
  },

  // Achievements
  achievementsContainer: {
    marginTop: 16,
  },
  achievementsTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 8,
  },
  achievementsList: {
    gap: 8,
  },
  achievementCard: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  achievementEmoji: {
    fontSize: 32,
    marginRight: 16,
  },
  achievementInfo: {
    flex: 1,
  },
  achievementName: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
  achievementDescription: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginTop: 2,
  },

  // Subscription
  subscriptionCard: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  subscriptionHeader: {
    marginBottom: 8,
  },
  subscriptionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
  },
  subscriptionBadge: {
    backgroundColor: color.$success,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  subscriptionBadgeText: {
    fontSize: 12,
    color: color.$text,
    fontWeight: "600",
  },
  subscriptionBadgeWarning: {
    backgroundColor: color.$warning,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  subscriptionBadgeWarningText: {
    fontSize: 12,
    color: color.$text,
    fontWeight: "600",
  },
  subscriptionSubtitle: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 4,
  },
  subscriptionDate: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginBottom: 8,
  },
  subscriptionFooter: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: color.$surface3,
  },
  subscriptionFooterText: {
    fontSize: 12,
    color: color.$text3,
    marginBottom: 4,
  },
  upgradeLink: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$primary,
  },

  // Trainer Promo
  trainerPromoBanner: {
    backgroundColor: color.$primary + "15",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: color.$primary + "30",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  trainerPromoContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
    gap: 16,
  },
  trainerPromoIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: color.$primary + "25",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  trainerPromoTextContainer: {
    flex: 1,
  },
  trainerPromoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: color.$text,
    marginBottom: 4,
  },
  trainerPromoDescription: {
    fontSize: 13,
    color: color.$text2,
    lineHeight: 18,
  },
  trainerPromoButton: {
    backgroundColor: color.$primary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    shadowColor: color.$primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  trainerPromoButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$bg,
  },

  // Trainer/Client cards
  clientsList: {
    gap: 8,
  },
  clientCard: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  clientAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 16,
  },
  clientAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text2,
    marginTop: 16,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text3,
    marginTop: 4,
    textAlign: "center",
  },

  // Menu Items
  menuItem: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  menuText: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
  },

  // Sign Out
  signOutButton: {
    backgroundColor: color.$error,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 8,
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "600" as const,
    lineHeight: 20,
    color: color.$text,
  },

  // Version
  versionSection: {
    alignItems: "center",
    paddingVertical: 32,
  },
  versionText: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: color.$text3,
  },
});
