import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherWorkoutRow } from "../TogetherWorkoutRow";
import { TogetherStartRow } from "../TogetherStartRow";
const members = [
  { userId: "me", name: "Brad Evans" },
  { userId: "mia", name: "Mia Osei" },
  { userId: "tom", name: "Tom Vance" },
];
it("renders avatars as tabs, the status line, Invite, End and the settings cog (canvas 1b)", () => {
  const p = {
    members,
    selectedId: "me",
    accountId: "me",
    status: "Waiting for people · 1 of 4",
    tone: "muted" as const,
    onSelect: jest.fn(),
    onSettings: jest.fn(),
    onInvite: jest.fn(),
    onEnd: jest.fn(),
  };
  const r = renderWithTheme(<TogetherWorkoutRow {...p} />);
  expect(r.getByText("BE")).toBeTruthy();
  expect(r.getByText("MO")).toBeTruthy();
  expect(r.getByText("TV")).toBeTruthy();
  expect(r.getByText(p.status)).toBeTruthy();
  const mine = r.getByLabelText("My workout");
  expect(mine.props.accessibilityRole).toBe("tab");
  expect(mine.props.accessibilityState.selected).toBe(true);
  fireEvent.press(r.getByLabelText("Mia Osei’s workout"));
  expect(p.onSelect).toHaveBeenCalledWith("mia");
  fireEvent.press(r.getByText("Invite"));
  expect(p.onInvite).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByText("End"));
  expect(p.onEnd).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByLabelText("Together settings"));
  expect(p.onSettings).toHaveBeenCalledTimes(1);
});
it("shows Leave for a guest, a live dot when in sync, and no Invite without a handler", () => {
  const r = renderWithTheme(
    <TogetherWorkoutRow
      members={members}
      selectedId="mia"
      accountId="me"
      status="In sync · 3 training"
      tone="live"
      endLabel="Leave"
      onSelect={() => {}}
      onSettings={() => {}}
      onEnd={() => {}}
    />,
  );
  expect(r.getByText("Leave")).toBeTruthy();
  expect(r.queryByText("Invite")).toBeNull();
  expect(r.queryByText("End")).toBeNull();
  expect(
    r.getByLabelText("Mia Osei’s workout").props.accessibilityState.selected,
  ).toBe(true);
  expect(r.getByLabelText("My workout").props.accessibilityState.selected).toBe(
    false,
  );
});
it("the solo strip names the kept sets and Start opens the sheet", () => {
  const onStart = jest.fn();
  const r = renderWithTheme(
    <TogetherStartRow detail="keeps your 4 logged sets" onStart={onStart} />,
  );
  expect(r.getByText(/keeps your 4 logged sets/)).toBeTruthy();
  expect(r.getByText("Train together")).toBeTruthy();
  fireEvent.press(r.getByTestId("together-start"));
  expect(onStart).toHaveBeenCalledTimes(1);
});
