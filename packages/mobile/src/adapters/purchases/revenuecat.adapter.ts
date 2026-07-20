import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesEntitlementInfo,
  type PurchasesPackage,
} from "react-native-purchases";
import type {
  ActiveEntitlement,
  PurchaseProduct,
  PurchasesError,
  PurchasesErrorKind,
  PurchasesPort,
} from "@/domain/ports/purchases.port";
import {
  billingCycleFromProductId,
  freeTrialDaysFromIntroOffer,
  tierFromProductId,
} from "@/domain/services/purchaseOfferings";
import { fail, ok, type Result } from "@/shared/errors";

/**
 * Production `PurchasesPort` backed by RevenueCat's `react-native-purchases`
 * (M12, iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md
 *
 * Native module — only functional on a real device / EAS dev build (Expo Go
 * runs RevenueCat's mock "Preview API mode"). Constructed iOS-only in
 * `providers.tsx`; web / Android keep the Stripe rail.
 *
 * The SDK exposes everything as static methods on `Purchases`; this adapter
 * wraps them behind the `Result`-returning port so containers stay free of
 * try/catch and the native dependency. Errors are mapped onto the
 * discriminated `PurchasesError` — chiefly `cancelled` (silent) vs. surfaced.
 *
 * The `default` offering is the contract (BRIEF: offering `default`,
 * `ofrng79adc3c998`). We read `offerings.all.default` falling back to
 * `offerings.current` so a dashboard rename of the "current" offering can't
 * silently empty the paywall.
 */

const DEFAULT_OFFERING_ID = "default";

export class RevenueCatPurchasesAdapter implements PurchasesPort {
  private configured = false;

  isConfigured(): boolean {
    return this.configured;
  }

  configure(publicSdkKey: string): void {
    if (this.configured) return;
    // Empty key (dev without the RC dashboard wired) → leave unconfigured so
    // the iOS flow shows its inline "unavailable" state instead of the SDK
    // throwing on the first call.
    if (publicSdkKey.length === 0) return;
    // iOS-only rail — never configure on Android (Stripe owns that platform).
    if (Platform.OS !== "ios") return;

    if (__DEV__) {
      void Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }
    Purchases.configure({ apiKey: publicSdkKey });
    this.configured = true;
  }

  async logIn(appUserId: string): Promise<Result<void, PurchasesError>> {
    if (!this.configured) {
      return fail(notConfigured("logIn"));
    }
    try {
      await Purchases.logIn(appUserId);
      return ok(undefined);
    } catch (err) {
      return fail(classifyPurchasesError(err));
    }
  }

  async logOut(): Promise<Result<void, PurchasesError>> {
    if (!this.configured) {
      // Nothing bound yet — logging out is a no-op, not an error.
      return ok(undefined);
    }
    try {
      await Purchases.logOut();
      return ok(undefined);
    } catch (err) {
      return fail(classifyPurchasesError(err));
    }
  }

  async getPurchasablePackages(): Promise<
    Result<PurchaseProduct[], PurchasesError>
  > {
    if (!this.configured) {
      return fail(notConfigured("getPurchasablePackages"));
    }
    try {
      const offerings = await Purchases.getOfferings();
      const offering =
        offerings.all[DEFAULT_OFFERING_ID] ?? offerings.current ?? null;
      if (offering === null) return ok([]);
      return ok(offering.availablePackages.map(toPurchaseProduct));
    } catch (err) {
      return fail(classifyPurchasesError(err));
    }
  }

  async purchase(
    packageId: string,
  ): Promise<Result<ActiveEntitlement[], PurchasesError>> {
    if (!this.configured) {
      return fail(notConfigured("purchase"));
    }
    try {
      const pkg = await this.findPackage(packageId);
      if (pkg === null) {
        return fail({
          kind: "store_problem",
          code: null,
          message: "That plan is no longer available. Please try again.",
        });
      }
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return ok(toActiveEntitlements(customerInfo));
    } catch (err) {
      return fail(classifyPurchasesError(err));
    }
  }

  async restore(): Promise<Result<ActiveEntitlement[], PurchasesError>> {
    if (!this.configured) {
      return fail(notConfigured("restore"));
    }
    try {
      const customerInfo = await Purchases.restorePurchases();
      return ok(toActiveEntitlements(customerInfo));
    } catch (err) {
      return fail(classifyPurchasesError(err));
    }
  }

  /**
   * Re-read the offering and find the raw RevenueCat package by id. Stateless
   * (no cached package list) so a stale handle can never drive a purchase of
   * the wrong product.
   */
  private async findPackage(
    packageId: string,
  ): Promise<PurchasesPackage | null> {
    const offerings = await Purchases.getOfferings();
    const offering =
      offerings.all[DEFAULT_OFFERING_ID] ?? offerings.current ?? null;
    if (offering === null) return null;
    return (
      offering.availablePackages.find((p) => p.identifier === packageId) ?? null
    );
  }
}

/** Normalise a RevenueCat package into the port's `PurchaseProduct`. */
function toPurchaseProduct(pkg: PurchasesPackage): PurchaseProduct {
  const productId = pkg.product.identifier;
  return {
    packageId: pkg.identifier,
    productId,
    tier: tierFromProductId(productId),
    billingCycle: billingCycleFromProductId(productId),
    priceString: pkg.product.priceString,
    // RevenueCat reflects the App Store Connect introductory offer on the
    // product; derive the free-trial length so the paywall copy matches it.
    introTrialDays: freeTrialDaysFromIntroOffer(pkg.product.introPrice),
  };
}

/** Map `CustomerInfo.entitlements.active` to the port's snapshot shape. */
function toActiveEntitlements(info: CustomerInfo): ActiveEntitlement[] {
  return Object.values(info.entitlements.active).map(
    (ent: PurchasesEntitlementInfo) => ({
      entitlementId: ent.identifier,
      tier: tierFromProductId(ent.productIdentifier),
      productId: ent.productIdentifier,
      expiresAt: ent.expirationDate,
    }),
  );
}

function notConfigured(op: string): PurchasesError {
  return {
    kind: "not_configured",
    code: null,
    message: `RevenueCat is not configured (called ${op}).`,
  };
}

/**
 * Map a thrown RevenueCat error onto the discriminated `PurchasesError`. Pure
 * — exported for tests. RevenueCat surfaces user-cancel via the
 * `userCancelled` boolean and a `PURCHASES_ERROR_CODE` string in `code`.
 */
export function classifyPurchasesError(err: unknown): PurchasesError {
  const e = (err ?? {}) as {
    userCancelled?: boolean;
    code?: string | number;
    message?: string;
    underlyingErrorMessage?: string;
  };

  if (e.userCancelled === true) {
    return {
      kind: "cancelled",
      code: codeToString(e.code),
      message: "Purchase cancelled.",
    };
  }

  const code = codeToString(e.code);
  const message =
    e.message ??
    e.underlyingErrorMessage ??
    "Something went wrong with the purchase. Please try again.";

  return { kind: kindFromCode(code, message), code, message };
}

function codeToString(code: string | number | undefined): string | null {
  if (code === undefined) return null;
  return String(code);
}

/**
 * Best-effort mapping of RevenueCat's error code / message onto our kinds.
 * RevenueCat's `PURCHASES_ERROR_CODE` values vary across SDK versions, so we
 * keyword-match defensively rather than enumerate them.
 */
function kindFromCode(
  code: string | null,
  message: string,
): PurchasesErrorKind {
  const haystack = `${code ?? ""} ${message}`.toLowerCase();
  if (haystack.includes("network")) return "network";
  if (
    haystack.includes("not allowed") ||
    haystack.includes("notallowed") ||
    haystack.includes("purchase_not_allowed")
  ) {
    return "purchase_not_allowed";
  }
  // Deferred purchase (Ask to Buy / SCA). RevenueCat surfaces this as
  // `PAYMENT_PENDING_ERROR`; it is NOT a failure, so match it BEFORE the
  // broad `payment` → store_problem catch below.
  if (haystack.includes("pending")) return "pending";
  if (
    haystack.includes("store") ||
    haystack.includes("product") ||
    haystack.includes("payment") ||
    haystack.includes("purchase")
  ) {
    return "store_problem";
  }
  return "unknown";
}
