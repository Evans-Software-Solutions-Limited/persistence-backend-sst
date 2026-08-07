import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { ClearPlanConfirmDialog } from "../ClearPlanConfirmDialog";

/**
 * Spec: specs/26-mealprint-meal-planning/AMENDMENT-2026-08-fuel-plan-surfacing.md § B
 */
describe("ClearPlanConfirmDialog", () => {
  it("renders the prompt + both CTAs, naming that logged food is kept", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ClearPlanConfirmDialog onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(getByText("Clear today's plan?")).toBeTruthy();
    expect(getByText(/stays in your diary/)).toBeTruthy();
    expect(getByTestId("clear-plan-confirm-cancel")).toBeTruthy();
    expect(getByTestId("clear-plan-confirm-confirm")).toBeTruthy();
  });

  it("fires onConfirm from the confirm CTA", () => {
    const onConfirm = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClearPlanConfirmDialog onCancel={jest.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.press(getByTestId("clear-plan-confirm-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel from the cancel CTA and the backdrop", () => {
    const onCancel = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClearPlanConfirmDialog onCancel={onCancel} onConfirm={jest.fn()} />,
    );
    fireEvent.press(getByTestId("clear-plan-confirm-cancel"));
    fireEvent.press(getByTestId("clear-plan-confirm-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows the processing label + disables CTAs while clearing", () => {
    const onConfirm = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <ClearPlanConfirmDialog
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        isProcessing
      />,
    );
    expect(getByText("Clearing…")).toBeTruthy();
    // Disabled Btn does not fire onPress.
    fireEvent.press(getByTestId("clear-plan-confirm-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
