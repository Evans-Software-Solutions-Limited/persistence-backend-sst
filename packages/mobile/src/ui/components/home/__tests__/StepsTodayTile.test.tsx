import { fireEvent } from "@testing-library/react-native";
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

  it("renders the unavailable state on Android / web", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <StepsTodayTile
        stepsToday={null}
        isAvailable={false}
        permissionStatus={{
          steps: "not_determined",
          calories: "not_determined",
          bodyWeight: "not_determined",
          heartRate: "not_determined",
        }}
        lastReadAt={null}
        onConnectPress={jest.fn()}
      />,
    );
    expect(getByTestId("steps-tile-unavailable")).toBeTruthy();
    expect(getByText(/Not available on Android/i)).toBeTruthy();
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
