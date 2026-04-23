import { fireEvent } from "@testing-library/react-native";
import { Platform } from "react-native";
import { StepsTodayTile } from "@/ui/components/home/StepsTodayTile";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("StepsTodayTile", () => {
  const grantedStatus = {
    steps: "granted" as const,
    calories: "granted" as const,
    bodyWeight: "granted" as const,
    heartRate: "granted" as const,
  };

  it("renders the granted state with value and success dot", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={4812}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={null}
        onConnectPress={jest.fn()}
      />,
    );
    expect(getByTestId("steps-tile-granted")).toBeTruthy();
    expect(getByText("4812")).toBeTruthy();
  });

  it("renders 0 when stepsToday is null but granted", () => {
    const { getByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={null}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={null}
        onConnectPress={jest.fn()}
      />,
    );
    expect(getByText("0")).toBeTruthy();
  });

  describe("unavailable state — platform-aware copy (bugbot regression PR #37)", () => {
    const unavailableProps = {
      stepsToday: null,
      isAvailable: false,
      permissionStatus: {
        steps: "not_determined" as const,
        calories: "not_determined" as const,
        bodyWeight: "not_determined" as const,
        heartRate: "not_determined" as const,
      },
      lastReadAt: null,
      onConnectPress: jest.fn(),
    };

    const originalOS = Platform.OS;
    afterEach(() => {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalOS,
      });
    });

    function setPlatform(os: "ios" | "android" | "web") {
      Object.defineProperty(Platform, "OS", { configurable: true, value: os });
    }

    it("renders the Android-specific copy on Android", () => {
      setPlatform("android");
      const { getByTestId, getByText } = renderWithTheme(
        <StepsTodayTile {...unavailableProps} />,
      );
      expect(getByTestId("steps-tile-unavailable")).toBeTruthy();
      expect(getByText("Not available on Android yet")).toBeTruthy();
    });

    it("renders the iOS-specific copy on iOS", () => {
      setPlatform("ios");
      const { getByText } = renderWithTheme(
        <StepsTodayTile {...unavailableProps} />,
      );
      expect(getByText("Health not available on this iOS build")).toBeTruthy();
    });

    it("renders the generic fallback copy on web / unknown platforms", () => {
      setPlatform("web");
      const { getByText } = renderWithTheme(
        <StepsTodayTile {...unavailableProps} />,
      );
      expect(getByText("Health data not available")).toBeTruthy();
    });
  });

  it("renders the Connect CTA when permission is denied / not_determined", () => {
    const onConnect = jest.fn();
    const { getByTestId } = renderWithTheme(
      <StepsTodayTile
        stepsToday={null}
        isAvailable
        permissionStatus={{
          steps: "denied",
          calories: "denied",
          bodyWeight: "denied",
          heartRate: "denied",
        }}
        lastReadAt={null}
        onConnectPress={onConnect}
      />,
    );
    const cta = getByTestId("steps-tile-connect");
    fireEvent.press(cta);
    expect(onConnect).toHaveBeenCalled();
  });

  it("renders a last-synced caption when lastReadAt is present", () => {
    const { getByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={1000}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={new Date().toISOString()}
        onConnectPress={jest.fn()}
      />,
    );
    expect(getByText(/Last synced/)).toBeTruthy();
  });

  it("renders minute-relative caption for reads a few minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { getByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={1000}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={fiveMinAgo}
        onConnectPress={jest.fn()}
      />,
    );
    expect(getByText(/5 min ago/)).toBeTruthy();
  });

  it("renders hour-relative caption for reads hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const { getByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={1000}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={twoHoursAgo}
        onConnectPress={jest.fn()}
      />,
    );
    expect(getByText(/2h ago/)).toBeTruthy();
  });

  it("handles unparseable lastReadAt by hiding the caption", () => {
    const { queryByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={1000}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt="not-a-date"
        onConnectPress={jest.fn()}
      />,
    );
    expect(queryByText(/Last synced/)).toBeNull();
  });
});
