import { resolveAndPrimeNotificationRoute } from "@/ui/navigation/notificationRoute";
import { HOME_ROUTE, TRAIN_ROUTE } from "@/application/notifications/deep-link";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";

describe("resolveAndPrimeNotificationRoute", () => {
  beforeEach(() => {
    useTrainSegment.setState({
      segment: "Workouts",
      pendingCreate: false,
      pendingSegment: null,
      hydrated: true,
    });
  });

  it("primes the Training segment one-shot for a train-bound link", () => {
    const route = resolveAndPrimeNotificationRoute("persistencemobile://train");
    expect(route).toBe(TRAIN_ROUTE);
    // Both writes, mirroring HomeContainer's cross-tab pattern: the one-shot
    // covers a frozen backgrounded hub; the live write covers a mounted one.
    expect(useTrainSegment.getState().pendingSegment).toBe("Training");
    expect(useTrainSegment.getState().segment).toBe("Training");
  });

  it("also primes when the deepLink is already the absolute train path", () => {
    const route = resolveAndPrimeNotificationRoute("/(app)/(tabs)/train");
    expect(route).toBe(TRAIN_ROUTE);
    expect(useTrainSegment.getState().pendingSegment).toBe("Training");
  });

  it("leaves the Train segment untouched for non-train links", () => {
    expect(
      resolveAndPrimeNotificationRoute("persistencemobile://requests"),
    ).toBe("/(app)/requests");
    expect(resolveAndPrimeNotificationRoute(null)).toBe(HOME_ROUTE);
    expect(useTrainSegment.getState().pendingSegment).toBeNull();
    expect(useTrainSegment.getState().segment).toBe("Workouts");
  });
});
