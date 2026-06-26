import type {
  ActiveEntitlement,
  PurchaseProduct,
  PurchasesError,
  PurchasesPort,
} from "@/domain/ports/purchases.port";
import { fail, ok, type Result } from "@/shared/errors";

/**
 * In-memory `PurchasesPort` for hook / container / presenter tests.
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Tests
 *
 * Configurable per-test: the configured state, the offering packages, and the
 * next purchase / restore / logIn outcome. Captures call counts + last inputs
 * so tests can assert identity wiring (`logIn(supabaseUserId)`), purchase
 * targeting, and restore invocation.
 */
export class MockPurchasesAdapter implements PurchasesPort {
  public configured = true;
  public packages: PurchaseProduct[] = [];

  public nextPackagesError: PurchasesError | null = null;
  public nextPurchaseResponse:
    | { ok: true; entitlements: ActiveEntitlement[] }
    | { ok: false; error: PurchasesError } = { ok: true, entitlements: [] };
  public nextRestoreResponse:
    | { ok: true; entitlements: ActiveEntitlement[] }
    | { ok: false; error: PurchasesError } = { ok: true, entitlements: [] };
  public nextLogInResponse:
    | { ok: true }
    | { ok: false; error: PurchasesError } = { ok: true };

  public configureCalls: string[] = [];
  public logInCalls: string[] = [];
  public logOutCalls = 0;
  public getPackagesCalls = 0;
  public purchaseCalls: string[] = [];
  public restoreCalls = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  configure(publicSdkKey: string): void {
    this.configureCalls.push(publicSdkKey);
    if (publicSdkKey.length > 0) this.configured = true;
  }

  async logIn(appUserId: string): Promise<Result<void, PurchasesError>> {
    this.logInCalls.push(appUserId);
    return this.nextLogInResponse.ok
      ? ok(undefined)
      : fail(this.nextLogInResponse.error);
  }

  async logOut(): Promise<Result<void, PurchasesError>> {
    this.logOutCalls += 1;
    return ok(undefined);
  }

  async getPurchasablePackages(): Promise<
    Result<PurchaseProduct[], PurchasesError>
  > {
    this.getPackagesCalls += 1;
    if (this.nextPackagesError !== null) return fail(this.nextPackagesError);
    return ok(this.packages);
  }

  async purchase(
    packageId: string,
  ): Promise<Result<ActiveEntitlement[], PurchasesError>> {
    this.purchaseCalls.push(packageId);
    return this.nextPurchaseResponse.ok
      ? ok(this.nextPurchaseResponse.entitlements)
      : fail(this.nextPurchaseResponse.error);
  }

  async restore(): Promise<Result<ActiveEntitlement[], PurchasesError>> {
    this.restoreCalls += 1;
    return this.nextRestoreResponse.ok
      ? ok(this.nextRestoreResponse.entitlements)
      : fail(this.nextRestoreResponse.error);
  }
}
