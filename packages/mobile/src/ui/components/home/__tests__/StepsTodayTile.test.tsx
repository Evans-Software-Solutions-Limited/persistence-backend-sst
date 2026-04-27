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

  it("renders the granted state with locale-formatted value", () => {
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
    expect(getByText("4,812")).toBeTruthy();
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

  it("renders the history graph when history is non-empty", () => {
    const history = [
      { date: new Date("2026-04-17"), steps: 3000 },
      { date: new Date("2026-04-18"), steps: 5200 },
      { date: new Date("2026-04-19"), steps: 4812 },
    ];
    const { toJSON } = renderWithTheme(
      <StepsTodayTile
        stepsToday={4812}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={null}
        onConnectPress={jest.fn()}
        history={history}
      />,
    );
    expect(JSON.stringify(toJSON())).toContain('"d":"M ');
  });

  it("omits the graph when history is empty", () => {
    const { toJSON } = renderWithTheme(
      <StepsTodayTile
        stepsToday={4812}
        isAvailable
        permissionStatus={grantedStatus}
        lastReadAt={null}
        onConnectPress={jest.fn()}
      />,
    );
    expect(JSON.stringify(toJSON())).not.toContain('"d":"M ');
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

  describe("MOCK chip (simulator-mock disclosure)", () => {
    it("renders a MOCK chip on the granted state when isMock=true", () => {
      const { getByTestId, getByText } = renderWithTheme(
        <StepsTodayTile
          stepsToday={4812}
          isAvailable
          permissionStatus={grantedStatus}
          lastReadAt={null}
          onConnectPress={jest.fn()}
          isMock
        />,
      );
      expect(getByTestId("steps-tile-mock-chip")).toBeTruthy();
      expect(getByText("MOCK")).toBeTruthy();
    });

    it("omits the MOCK chip when isMock=false (default)", () => {
      const { queryByTestId } = renderWithTheme(
        <StepsTodayTile
          stepsToday={4812}
          isAvailable
          permissionStatus={grantedStatus}
          lastReadAt={null}
          onConnectPress={jest.fn()}
        />,
      );
      expect(queryByTestId("steps-tile-mock-chip")).toBeNull();
    });
  });
});
