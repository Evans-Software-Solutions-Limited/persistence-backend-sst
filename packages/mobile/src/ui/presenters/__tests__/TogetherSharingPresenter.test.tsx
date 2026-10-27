import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherSharingPresenter } from "../TogetherSharingPresenter";
import { sharingState, type SharingPerson } from "../togetherSharing";

const people: SharingPerson[] = [
  { userId: "b", name: "Brad", tone: "info" },
  { userId: "t", name: "Tom", tone: "success" },
  { userId: "i", name: "Inés", tone: "gold" },
];
const state = (
  over: Partial<{
    numbers: boolean;
    logging: boolean;
    previous: Record<string, boolean>;
  }> = {},
  refused: Parameters<typeof sharingState>[2] = null,
) =>
  sharingState(
    {
      numbers: true,
      logging: false,
      previous: { b: true, t: true, i: true },
      ...over,
    },
    people,
    refused,
  );
const props = () => ({
  visible: true,
  state: state(),
  onChange: jest.fn(),
  onDone: jest.fn(),
});
const checked = (r: ReturnType<typeof renderWithTheme>, label: string) =>
  r.getByLabelText(label).props.accessibilityState.checked;

it("phone 1: three switches for this session, explained, and Done", () => {
  const p = props();
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  expect(r.getByText("Together settings")).toBeTruthy();
  expect(
    r.getByText(
      "This session only. Defaults live in Train › Together › Settings.",
    ),
  ).toBeTruthy();
  expect(r.getByText("What you share")).toBeTruthy();
  expect(checked(r, "Show my numbers")).toBe(true);
  expect(checked(r, "Share previous values")).toBe(true);
  expect(checked(r, "Let others fill in my sets")).toBe(false);
  expect(
    r.getByText(
      "Anyone here could log on your record. Turn it off at any time.",
    ),
  ).toBeTruthy();
  fireEvent.press(r.getByLabelText("Show my numbers"));
  expect(p.onChange).toHaveBeenLastCalledWith({ key: "numbers", value: false });
  fireEvent.press(r.getByLabelText("Let others fill in my sets"));
  expect(p.onChange).toHaveBeenLastCalledWith({ key: "logging", value: true });
  fireEvent.press(r.getByLabelText("Share previous values"));
  expect(p.onChange).toHaveBeenLastCalledWith({
    key: "previous",
    value: false,
  });
  fireEvent.press(r.getByTestId("together-sharing-done"));
  expect(p.onDone).toHaveBeenCalled();
  // A guest's sheet: no Who can join, nobody to remove, no notice.
  expect(r.queryByText("Who can join")).toBeNull();
  expect(r.queryByText("Remove")).toBeNull();
  expect(r.queryByTestId("together-sharing-refused")).toBeNull();
});

it("phone 2: a chip per partner narrows previous values", () => {
  const p = props();
  p.state = state({ previous: { b: true, t: false, i: true } });
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  const chip = (name: string) =>
    r.getByLabelText(`Share previous values with ${name}`);
  expect(chip("Brad").props.accessibilityState.checked).toBe(true);
  expect(chip("Tom").props.accessibilityState.checked).toBe(false);
  fireEvent.press(chip("Tom"));
  expect(p.onChange).toHaveBeenLastCalledWith({ recipient: "t", value: true });
  fireEvent.press(chip("Inés"));
  expect(p.onChange).toHaveBeenLastCalledWith({ recipient: "i", value: false });
});

it("hides the chips while previous values are off", () => {
  const p = props();
  p.state = state({ previous: {} });
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  expect(checked(r, "Share previous values")).toBe(false);
  expect(r.queryByLabelText("Share previous values with Brad")).toBeNull();
});

it("phone 3: a refused change shows one notice", () => {
  const p = props();
  p.state = state({}, { key: "logging", wanted: true });
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  expect(r.getByTestId("together-sharing-refused")).toBeTruthy();
  expect(
    r.getByText(
      "Couldn’t turn on fill-in. The session didn’t accept it, so it’s switched back off.",
    ),
  ).toBeTruthy();
});

it("gives the host Who can join and Remove", () => {
  const p = {
    ...props(),
    audience: { value: "friends" as const, online: true, onChange: jest.fn() },
    removable: people.slice(0, 1),
    onRemove: jest.fn(),
  };
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  expect(r.getByText("Who can join")).toBeTruthy();
  fireEvent.press(r.getByRole("radio", { name: "Private" }));
  expect(p.audience.onChange).toHaveBeenCalledWith("invite-only");
  fireEvent.press(r.getByLabelText("Remove Brad from the session"));
  expect(p.onRemove).toHaveBeenCalledWith("b");
});

it("says sharing has ended when there is no live session", () => {
  const p = { ...props(), state: null };
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  expect(
    r.getByText("Sharing has ended. Your own workout carries on here."),
  ).toBeTruthy();
  expect(r.queryByText("What you share")).toBeNull();
});
