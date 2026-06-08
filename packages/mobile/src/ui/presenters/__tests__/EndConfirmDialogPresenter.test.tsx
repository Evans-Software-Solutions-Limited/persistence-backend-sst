import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { EndConfirmDialogPresenter } from "../EndConfirmDialogPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

describe("EndConfirmDialogPresenter", () => {
  it("renders the title + elapsed-bearing body", () => {
    const { getByText } = renderWithTheme(
      <EndConfirmDialogPresenter
        elapsed="12:30"
        onKeepGoing={jest.fn()}
        onEnd={jest.fn()}
      />,
    );
    expect(getByText("End workout?")).toBeTruthy();
    expect(
      getByText(
        "Your progress so far (12:30) won't be saved as a completed workout.",
      ),
    ).toBeTruthy();
  });

  it("'Keep going' fires onKeepGoing", () => {
    const onKeepGoing = jest.fn();
    const onEnd = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EndConfirmDialogPresenter
        elapsed="0:30"
        onKeepGoing={onKeepGoing}
        onEnd={onEnd}
      />,
    );
    fireEvent.press(getByTestId("end-confirm-dialog-keep-going"));
    expect(onKeepGoing).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("'End' fires onEnd", () => {
    const onKeepGoing = jest.fn();
    const onEnd = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EndConfirmDialogPresenter
        elapsed="0:30"
        onKeepGoing={onKeepGoing}
        onEnd={onEnd}
      />,
    );
    fireEvent.press(getByTestId("end-confirm-dialog-end"));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onKeepGoing).not.toHaveBeenCalled();
  });

  it("backdrop tap dismisses via onKeepGoing (STORY-005 AC 5.4)", () => {
    const onKeepGoing = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EndConfirmDialogPresenter
        elapsed="0:30"
        onKeepGoing={onKeepGoing}
        onEnd={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("end-confirm-dialog-backdrop"));
    expect(onKeepGoing).toHaveBeenCalledTimes(1);
  });

  it("card claims the touch (onStartShouldSetResponder) so taps on it don't dismiss", () => {
    const onKeepGoing = jest.fn();
    const { getByTestId } = renderWithTheme(
      <EndConfirmDialogPresenter
        elapsed="0:30"
        onKeepGoing={onKeepGoing}
        onEnd={jest.fn()}
      />,
    );
    // The card's responder returns true (claims the gesture); a tap on the
    // card must NOT bubble to the backdrop's dismiss.
    fireEvent(getByTestId("end-confirm-dialog"), "startShouldSetResponder");
    expect(onKeepGoing).not.toHaveBeenCalled();
  });

  it("honours a custom testID", () => {
    const { getByTestId } = renderWithTheme(
      <EndConfirmDialogPresenter
        elapsed="0:30"
        onKeepGoing={jest.fn()}
        onEnd={jest.fn()}
        testID="custom-end"
      />,
    );
    expect(getByTestId("custom-end")).toBeTruthy();
    expect(getByTestId("custom-end-end")).toBeTruthy();
    expect(getByTestId("custom-end-keep-going")).toBeTruthy();
  });
});
