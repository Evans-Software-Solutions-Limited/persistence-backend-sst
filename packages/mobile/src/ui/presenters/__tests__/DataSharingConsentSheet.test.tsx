import { Linking } from "react-native";
import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import {
  DataSharingConsentSheet,
  type DataSharingConsentSheetProps,
} from "../DataSharingConsentSheet";

/**
 * 26-coach-data-sharing-consent — the shared UK GDPR Art 9(2)(a) explicit-
 * consent sheet reused by both `<RequestsPresenter>` (accept) and
 * `<AcceptInvitePresenter>` (redeem). Exercised directly here so both call
 * sites' own tests can stay focused on wiring (props in, callback out)
 * rather than re-proving the checkbox/copy/link mechanics twice.
 */

function baseProps(
  over: Partial<DataSharingConsentSheetProps> = {},
): DataSharingConsentSheetProps {
  return {
    visible: true,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    isSubmitting: false,
    confirmLabel: "Accept",
    testIDPrefix: "test",
    ...over,
  };
}

describe("DataSharingConsentSheet", () => {
  it("renders nothing when not visible", () => {
    const { queryByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps({ visible: false })} />,
    );
    expect(queryByTestId("test-consent-sheet")).toBeNull();
  });

  it("renders the required copy blocks and the confirm label", () => {
    const { getByText } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps()} />,
    );
    expect(getByText("Share your data with your coach")).toBeTruthy();
    expect(
      getByText(/your body measurements \(like weight and body fat\)/),
    ).toBeTruthy();
    expect(getByText(/sleep, heart rate, steps/)).toBeTruthy();
    expect(getByText(/leaving your coach/)).toBeTruthy();
    expect(
      getByText("I agree to share the data above with my coach."),
    ).toBeTruthy();
    expect(getByText("Read our Privacy Policy")).toBeTruthy();
    expect(getByText("Accept")).toBeTruthy();
  });

  it("starts unticked and disables confirm until ticked", () => {
    const { getByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps()} />,
    );
    expect(
      getByTestId("test-consent-checkbox").props.accessibilityState?.checked,
    ).toBe(false);
    expect(
      getByTestId("test-consent-confirm").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("does not call onConfirm while unticked, and calls it once ticked", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...props} />,
    );

    fireEvent.press(getByTestId("test-consent-confirm"));
    expect(props.onConfirm).not.toHaveBeenCalled();

    fireEvent.press(getByTestId("test-consent-checkbox"));
    expect(
      getByTestId("test-consent-checkbox").props.accessibilityState?.checked,
    ).toBe(true);
    expect(
      getByTestId("test-consent-confirm").props.accessibilityState?.disabled,
    ).toBe(false);

    fireEvent.press(getByTestId("test-consent-confirm"));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("re-ticking twice untoggles back to unchecked", () => {
    const { getByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps()} />,
    );
    fireEvent.press(getByTestId("test-consent-checkbox"));
    fireEvent.press(getByTestId("test-consent-checkbox"));
    expect(
      getByTestId("test-consent-checkbox").props.accessibilityState?.checked,
    ).toBe(false);
  });

  it("resets to unticked every time the sheet re-opens — never pre-ticked", () => {
    const { getByTestId, rerender } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps({ visible: true })} />,
    );
    fireEvent.press(getByTestId("test-consent-checkbox"));
    expect(
      getByTestId("test-consent-checkbox").props.accessibilityState?.checked,
    ).toBe(true);

    // Close, then re-open — must start unticked again.
    rerender(<DataSharingConsentSheet {...baseProps({ visible: false })} />);
    rerender(<DataSharingConsentSheet {...baseProps({ visible: true })} />);

    expect(
      getByTestId("test-consent-checkbox").props.accessibilityState?.checked,
    ).toBe(false);
  });

  it("disables the confirm button while submitting even when ticked", () => {
    const { getByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps({ isSubmitting: true })} />,
    );
    fireEvent.press(getByTestId("test-consent-checkbox"));
    expect(
      getByTestId("test-consent-confirm").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("opens the privacy policy URL via Linking.openURL", () => {
    const openURLSpy = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(true as unknown as void);
    const { getByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps()} />,
    );
    fireEvent.press(getByTestId("test-privacy-link"));
    expect(openURLSpy).toHaveBeenCalledWith(
      "https://persistence.evans-software-solutions.com/privacy",
    );
    openURLSpy.mockRestore();
  });

  it("swallows a Linking.openURL rejection without throwing", async () => {
    const openURLSpy = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValue(new Error("no browser"));
    const { getByTestId } = renderWithTheme(
      <DataSharingConsentSheet {...baseProps()} />,
    );
    expect(() =>
      fireEvent.press(getByTestId("test-privacy-link")),
    ).not.toThrow();
    // Flush the rejected promise's .catch() handler.
    await Promise.resolve();
    await Promise.resolve();
    openURLSpy.mockRestore();
  });
});
