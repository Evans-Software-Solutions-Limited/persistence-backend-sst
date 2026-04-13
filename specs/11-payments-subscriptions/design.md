# 11 — Payments & Subscriptions: Technical Design

## Domain Models

```typescript
// src/domain/models/subscription.ts
export interface UserSubscription {
  id: string;
  userId: string;
  tierId: string;
  tierName: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

export type SubscriptionTier = "free" | "premium" | "trainer";
export type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "past_due"
  | "trialing"
  | "unpaid";

export interface SubscriptionTierInfo {
  id: string;
  name: SubscriptionTier;
  displayName: string;
  price: number; // monthly in cents
  features: string[];
  limits: SubscriptionLimits;
}

export interface SubscriptionLimits {
  maxWorkouts: number | null; // null = unlimited
  maxCustomExercises: number | null;
  hasProgressAnalytics: boolean;
  hasHealthIntegration: boolean;
  hasTrainerFeatures: boolean;
}
```

## Payments Port

```typescript
// src/domain/ports/payments.port.ts
export interface PaymentsPort {
  initializePaymentSheet(
    tierId: string,
  ): Promise<Result<PaymentSheetParams, PaymentError>>;
  presentPaymentSheet(): Promise<Result<void, PaymentError>>;
  isApplePayAvailable(): Promise<boolean>;
  isGooglePayAvailable(): Promise<boolean>;
}
```

## Subscription State

Server-authoritative. Checked on:

1. App launch → fetch from API
2. Cached in memory for session duration
3. Offline: use last-known with "stale subscription" warning after 24h
4. Feature gates check cached subscription synchronously

```typescript
// src/ui/hooks/useSubscription.ts
interface SubscriptionState {
  subscription: UserSubscription | null;
  tier: SubscriptionTier;
  limits: SubscriptionLimits;
  isLoading: boolean;
  isStale: boolean; // >24h since last server check
}

// src/ui/hooks/useFeatureGate.ts
export function useFeatureGate(feature: keyof SubscriptionLimits): {
  allowed: boolean;
  showUpgrade: () => void;
};
```

## UI Components

```
containers/SubscriptionContainer.tsx        # Fetches tiers + current sub
presenters/SubscriptionPresenter.tsx        # Tier comparison
containers/CheckoutContainer.tsx            # Payment flow
presenters/CheckoutPresenter.tsx            # Payment UI
containers/SubscriptionManageContainer.tsx  # Manage/cancel
presenters/SubscriptionManagePresenter.tsx  # Management UI
components/TierCard.tsx                     # Single tier display
components/FeatureGatePrompt.tsx            # Upgrade prompt for gated features
components/SubscriptionBadge.tsx            # Current tier indicator
```

## Stripe Integration

- `@stripe/stripe-react-native` for payment sheet
- Backend creates Stripe PaymentIntent / SetupIntent
- App presents Stripe payment sheet (handles Apple Pay, Google Pay, cards)
- Backend webhook confirms subscription activation
- No card numbers ever touch the mobile app
