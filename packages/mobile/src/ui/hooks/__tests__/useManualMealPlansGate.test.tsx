import { act, renderHook } from "@testing-library/react-native";
import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { liveTierName } from "@/ui/hooks/useMealprintGate";
import {
  computeManualPlansVerdict,
  useManualMealPlansGate,
} from "@/ui/hooks/useManualMealPlansGate";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockPush(...a) },
}));
let mockSub: { data?: MySubscription; isError: boolean; accessNowMs: number };
jest.mock("@/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => mockSub,
}));

function subscription(
  tierName: SubscriptionTierName,
  over: Partial<MySubscription> = {},
): MySubscription {
  return {
    subscriptionId: "sub-1",
    tierName,
    paymentStatus: "active",
    billingCycle: "annual",
    expiresAt: null,
    cancelledAt: null,
    isTrainerTier: false,
    scheduledChange: null,
    ...over,
  } as MySubscription;
}

describe("manual meal plans gate (PER-133)", () => {
  it("Premium, Premium+ and coach tiers can make their own plans; Free can't", () => {
    expect(computeManualPlansVerdict("premium", false)).toBe(true);
    expect(computeManualPlansVerdict("premium_plus", false)).toBe(true);
    expect(computeManualPlansVerdict("coach", false)).toBe(true);
    expect(computeManualPlansVerdict("free", false)).toBe(false);
    expect(computeManualPlansVerdict(null, false)).toBe(false);
    expect(computeManualPlansVerdict("free", true)).toBe(true);
  });

  it("liveTierName: only a live paid subscription counts", () => {
    expect(liveTierName(null)).toBeNull();
    expect(liveTierName(subscription("premium"))).toBe("premium");
    expect(
      liveTierName(subscription("premium", { paymentStatus: "unpaid" })),
    ).toBeNull();
    expect(
      liveTierName(
        subscription("premium", {
          scheduledChange: {
            nextTierName: "free",
            effectiveAt: "2020-01-01T00:00:00Z",
          } as MySubscription["scheduledChange"],
        }),
      ),
    ).toBe("free");
  });

  it("the hook: resolved verdict and the Premium upsell", () => {
    mockSub = {
      data: subscription("free"),
      isError: false,
      accessNowMs: Date.now(),
    };
    const { result, rerender } = renderHook(() => useManualMealPlansGate());
    expect(result.current).toMatchObject({ allowed: false, isResolved: true });
    act(() => result.current.onUpgrade());
    expect(mockPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=premium&cycle=annual",
    );
    mockSub = { data: undefined, isError: false, accessNowMs: Date.now() };
    rerender({});
    expect(result.current.isResolved).toBe(false);
    act(() => result.current.onUpgrade());
    expect(mockPush).toHaveBeenLastCalledWith(
      "/(auth)/subscription-selection?tier=premium&cycle=monthly",
    );
    mockSub = {
      data: subscription("premium"),
      isError: false,
      accessNowMs: Date.now(),
    };
    rerender({});
    expect(result.current.allowed).toBe(true);
  });
});
