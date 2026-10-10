import React from "react";
import { Modal } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { EndConfirmDialogPresenter } from "@/ui/presenters/EndConfirmDialogPresenter";
import { DiscardWorkoutConfirmationContainer } from "../DiscardWorkoutConfirmationContainer";
import { useDiscardConfirmation } from "@/state/discard-workout";

beforeEach(() => useDiscardConfirmation.getState().close());
it("cancels without discarding and clears the confirmation before confirming exactly once", () => {
  const onConfirm = jest.fn(() =>
    expect(useDiscardConfirmation.getState().request).toBeNull(),
  );
  const r = renderWithTheme(<DiscardWorkoutConfirmationContainer />);
  const request = { ownerKey: "me:workout", onConfirm };
  act(() => useDiscardConfirmation.getState().open(request));
  expect(r.getByText("Discard workout?")).toBeTruthy();
  fireEvent.press(r.getByText("Keep"));
  expect(onConfirm).not.toHaveBeenCalled();
  act(() => useDiscardConfirmation.getState().open(request));
  const retained = r.UNSAFE_getByType(EndConfirmDialogPresenter).props.onEnd;
  fireEvent.press(r.getByText("Discard"));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  act(() => retained());
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
it("ignores cleanup from an older owner and allows backdrop cancellation", () => {
  const old = { ownerKey: "old:workout", onConfirm: jest.fn() };
  const current = { ownerKey: "new:workout", onConfirm: jest.fn() };
  const r = renderWithTheme(<DiscardWorkoutConfirmationContainer />);
  act(() => {
    useDiscardConfirmation.getState().open(old);
    useDiscardConfirmation.getState().open(current);
    useDiscardConfirmation.getState().close(old);
  });
  expect(useDiscardConfirmation.getState().request).toBe(current);
  fireEvent.press(r.getByTestId("discard-workout-dialog-backdrop"));
  expect(useDiscardConfirmation.getState().request).toBeNull();
  expect(current.onConfirm).not.toHaveBeenCalled();
});

it("a retained hidden dialog cannot dismiss or confirm a later request", () => {
  const r = renderWithTheme(<DiscardWorkoutConfirmationContainer />);
  const hidden = r.UNSAFE_getByType(Modal).props.children.props;
  const current = { ownerKey: "me:new", onConfirm: jest.fn() };
  act(() => useDiscardConfirmation.getState().open(current));
  act(() => {
    hidden.onEnd();
    hidden.onKeepGoing();
  });
  expect(useDiscardConfirmation.getState().request).toBe(current);
  expect(current.onConfirm).not.toHaveBeenCalled();
});
