import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ModeSwitchCardPresenter } from "../ModeSwitchCardPresenter";

/**
 * Spec: specs/08-profile-settings/requirements.md STORY-003 (AC 3.3–3.6)
 *       specs/08-profile-settings/design.md § <ModeSwitchCardPresenter>
 */
describe("ModeSwitchCardPresenter", () => {
  it("athlete variant: Trainer Mode copy + Switch CTA targeting coach", () => {
    const onSwitch = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <ModeSwitchCardPresenter
        mode="athlete"
        onSwitch={onSwitch}
        testID="card"
      />,
    );
    expect(getByText("Trainer Mode")).toBeTruthy();
    expect(getByText("Switch to manage your clients")).toBeTruthy();
    expect(getByText("Switch")).toBeTruthy();

    fireEvent.press(getByTestId("card-cta"));
    expect(onSwitch).toHaveBeenCalledWith("coach");
  });

  it("coach variant with a known client count: Coaching N clients", () => {
    const onSwitch = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <ModeSwitchCardPresenter
        mode="coach"
        clientCount={8}
        onSwitch={onSwitch}
        testID="card"
      />,
    );
    expect(getByText("Coaching 8 clients")).toBeTruthy();
    expect(getByText("Athletes feel like normal users")).toBeTruthy();
    expect(getByText("Athlete")).toBeTruthy();

    fireEvent.press(getByTestId("card-cta"));
    expect(onSwitch).toHaveBeenCalledWith("athlete");
  });

  it("coach variant without a count falls back to count-free copy (AC 3.6)", () => {
    const { getByText } = renderWithTheme(
      <ModeSwitchCardPresenter mode="coach" onSwitch={jest.fn()} />,
    );
    expect(getByText("Coaching your clients")).toBeTruthy();
  });
});
