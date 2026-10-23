import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherAthleteAvatar,
  togetherInitials,
  togetherInitialsSize,
} from "../TogetherAthleteAvatar";
import { TogetherPill } from "../TogetherPill";
it("builds initials and renders the ring tone, selection and press", () => {
  expect(togetherInitials("Inés Marco")).toBe("IM");
  expect(togetherInitials("  brad  ")).toBe("B");
  const onPress = jest.fn();
  const r = renderWithTheme(
    <TogetherAthleteAvatar
      name="Mia Osei"
      tone="gold"
      selected
      onPress={onPress}
    />,
  );
  fireEvent.press(r.getByLabelText("View Mia Osei’s workout"));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(r.getByText("MO")).toBeTruthy();
  r.rerender(
    <TogetherAthleteAvatar name="Tom Vance" tone="success" size={36} />,
  );
  expect(r.getByText("TV")).toBeTruthy();
  expect(r.queryByRole("button")).toBeNull();
});
it("the pill is a 32pt neutral or primary control that respects disabled", () => {
  const onPress = jest.fn();
  const r = renderWithTheme(
    <TogetherPill onPress={onPress} tone="primary" testID="pill">
      Start
    </TogetherPill>,
  );
  fireEvent.press(r.getByText("Start"));
  expect(onPress).toHaveBeenCalledTimes(1);
  r.rerender(
    <TogetherPill
      onPress={onPress}
      disabled
      accessibilityLabel="Close"
      testID="pill"
    />,
  );
  fireEvent.press(r.getByLabelText("Close"));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(r.getByLabelText("Close").props.accessibilityState.disabled).toBe(
    true,
  );
});

it("sizes initials like the canvas: 10 at 22, 11 at 26–28, 13 at 36, a third above that", () => {
  expect(togetherInitialsSize(22)).toBe(10);
  expect(togetherInitialsSize(26)).toBe(11);
  expect(togetherInitialsSize(28)).toBe(11);
  expect(togetherInitialsSize(36)).toBe(13);
  expect(togetherInitialsSize(72)).toBe(24);
});
