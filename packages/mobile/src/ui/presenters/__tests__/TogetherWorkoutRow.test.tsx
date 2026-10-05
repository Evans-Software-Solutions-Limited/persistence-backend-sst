import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherWorkoutRow } from "../TogetherWorkoutRow";
it("selects the deliberate athlete and keeps end/settings distinct", () => {
  const p = {
    members: [
      { userId: "me", name: "Brad Evans" },
      { userId: "other", name: "Mia" },
    ],
    selectedId: "me",
    status: "Reconnecting · saved locally",
    onSelect: jest.fn(),
    onSettings: jest.fn(),
    onEnd: jest.fn(),
  };
  const r = renderWithTheme(<TogetherWorkoutRow {...p} />);
  expect(r.getByText("BE")).toBeTruthy();
  expect(r.getByText("M")).toBeTruthy();
  fireEvent.press(r.getByLabelText("View Mia’s workout"));
  expect(p.onSelect).toHaveBeenCalledWith("other");
  fireEvent.press(r.getByText("End"));
  expect(p.onEnd).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByLabelText("Together settings"));
  expect(p.onSettings).toHaveBeenCalledTimes(1);
  expect(r.getByText(p.status)).toBeTruthy();
});
