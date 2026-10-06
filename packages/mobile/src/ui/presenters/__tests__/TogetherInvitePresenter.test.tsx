import React from "react";
import { View } from "react-native";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherInvitePresenter } from "../TogetherInvitePresenter";

it.each([true, false])(
  "shows truthful audience and sharing state for friends-only=%s",
  (friendsOnly) => {
    const actions = {
      onCopy: jest.fn(),
      onShare: jest.fn(),
      onSettings: jest.fn(),
    };
    const r = renderWithTheme(
      <TogetherInvitePresenter
        {...actions}
        friendsOnly={friendsOnly}
        personal={friendsOnly}
        pendingCount={friendsOnly ? 0 : 1}
        qr={<View testID="actual-invitation" />}
        notice="Could not copy"
      />,
    );
    expect(r.getByTestId("actual-invitation")).toBeTruthy();
    expect(r.getByText("Could not copy")).toBeTruthy();
    if (friendsOnly) {
      expect(r.getByText(/Only accepted training partners/)).toBeTruthy();
      expect(r.getByText(/Your workout is still personal/)).toBeTruthy();
      expect(r.queryByText(/anyone else needs your approval/)).toBeNull();
    } else {
      expect(r.getByText(/anyone else needs your approval/)).toBeTruthy();
      expect(r.getByText("1 athlete waiting for approval")).toBeTruthy();
      expect(r.queryByText(/Your workout is still personal/)).toBeNull();
    }
    fireEvent.press(r.getByText("Copy"));
    fireEvent.press(r.getByText("Share"));
    fireEvent.press(r.getByLabelText("Session settings"));
    expect(actions.onCopy).toHaveBeenCalledTimes(1);
    expect(actions.onShare).toHaveBeenCalledTimes(1);
    expect(actions.onSettings).toHaveBeenCalledTimes(1);
  },
);

it("summarizes multiple real approval requests without claiming they joined", () => {
  const r = renderWithTheme(
    <TogetherInvitePresenter
      personal={false}
      pendingCount={3}
      qr={null}
      onCopy={() => {}}
      onShare={() => {}}
      onSettings={() => {}}
    />,
  );
  expect(r.getByText("3 athletes waiting for approval")).toBeTruthy();
});
