import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { SignOutConfirmDialog } from "../SignOutConfirmDialog";

/**
 * Spec: specs/08-profile-settings/requirements.md STORY-007 (AC 7.2, 7.3)
 *       specs/08-profile-settings/design.md § <SignOutConfirmDialog>
 */
describe("SignOutConfirmDialog", () => {
  it("renders the prompt + both CTAs", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <SignOutConfirmDialog onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(getByText("Sign out?")).toBeTruthy();
    expect(getByTestId("sign-out-confirm-cancel")).toBeTruthy();
    expect(getByTestId("sign-out-confirm-confirm")).toBeTruthy();
  });

  it("fires onConfirm from the confirm CTA", () => {
    const onConfirm = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignOutConfirmDialog onCancel={jest.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.press(getByTestId("sign-out-confirm-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel from the cancel CTA and the backdrop", () => {
    const onCancel = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignOutConfirmDialog onCancel={onCancel} onConfirm={jest.fn()} />,
    );
    fireEvent.press(getByTestId("sign-out-confirm-cancel"));
    fireEvent.press(getByTestId("sign-out-confirm-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows the processing label + disables CTAs while signing out", () => {
    const onConfirm = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <SignOutConfirmDialog
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        isProcessing
      />,
    );
    expect(getByText("Signing out…")).toBeTruthy();
    // Disabled Btn does not fire onPress.
    fireEvent.press(getByTestId("sign-out-confirm-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
