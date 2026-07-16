import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import type { HealthPermissionStatus } from "@/domain/ports/health.port";
import { HealthSettingsPresenter } from "../HealthSettingsPresenter";

const NONE: HealthPermissionStatus = {
  steps: "not_determined",
  calories: "not_determined",
  bodyWeight: "not_determined",
  heartRate: "not_determined",
  sleep: "not_determined",
};
const GRANTED: HealthPermissionStatus = {
  steps: "granted",
  calories: "granted",
  bodyWeight: "denied",
  heartRate: "not_determined",
  sleep: "not_determined",
};

describe("HealthSettingsPresenter", () => {
  it("shows the connect CTA when available but not yet granted", () => {
    const onConnect = jest.fn();
    const { getByTestId, queryByTestId } = renderWithTheme(
      <HealthSettingsPresenter
        isAvailable
        permissionStatus={NONE}
        isReading={false}
        isRequesting={false}
        stepsToday={null}
        onBack={jest.fn()}
        onConnect={onConnect}
      />,
    );
    expect(queryByTestId("health-unavailable")).toBeNull();
    fireEvent.press(getByTestId("health-connect-btn"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("disables the button and does not fire while a request is in flight", () => {
    const onConnect = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HealthSettingsPresenter
        isAvailable
        permissionStatus={NONE}
        isReading={false}
        isRequesting
        stepsToday={null}
        onBack={jest.fn()}
        onConnect={onConnect}
      />,
    );
    fireEvent.press(getByTestId("health-connect-btn"));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("renders the unavailable copy and no connect button on an unsupported device", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <HealthSettingsPresenter
        isAvailable={false}
        permissionStatus={NONE}
        isReading={false}
        isRequesting={false}
        stepsToday={null}
        onBack={jest.fn()}
        onConnect={jest.fn()}
      />,
    );
    expect(getByTestId("health-unavailable")).toBeTruthy();
    expect(queryByTestId("health-connect-btn")).toBeNull();
  });

  it("shows today's steps and the metric list once connected", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <HealthSettingsPresenter
        isAvailable
        permissionStatus={GRANTED}
        isReading={false}
        isRequesting={false}
        stepsToday={8421}
        onBack={jest.fn()}
        onConnect={jest.fn()}
      />,
    );
    expect(queryByTestId("health-connect-btn")).toBeNull();
    expect(getByTestId("health-steps-today")).toBeTruthy();
    // Per-metric rows render for each tracked data type.
    expect(getByTestId("health-metric-steps")).toBeTruthy();
    expect(getByTestId("health-metric-heartRate")).toBeTruthy();
  });

  it("invokes onBack from the header back button", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HealthSettingsPresenter
        isAvailable
        permissionStatus={GRANTED}
        isReading
        isRequesting={false}
        stepsToday={null}
        onBack={onBack}
        onConnect={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("health-settings-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
