import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherSettingsPresenter } from "../TogetherSettingsPresenter";
import { TogetherBlockedPresenter } from "../TogetherBlockedPresenter";

const props = () => ({
  audience: "friends" as const,
  onAudience: jest.fn(),
  sharing: { numbers: true, previous: true, logging: false },
  onSharing: jest.fn(),
  discoverable: false,
  onDiscoverable: jest.fn(),
  partnersCount: 3,
  blockedCount: 2,
  onPartners: jest.fn(),
  onBlocked: jest.fn(),
  onBack: jest.fn(),
});

it("Together settings shows the defaults, the sharing switches, find-by-name and the two lists (canvas row 4)", () => {
  const p = props();
  const r = renderWithTheme(<TogetherSettingsPresenter {...p} />);
  expect(r.getByText("Settings")).toBeTruthy();
  expect(r.getByText("Every new session starts with")).toBeTruthy();
  expect(r.getByRole("radio", { name: "Partners" })).toBeTruthy();
  fireEvent.press(r.getByRole("radio", { name: "Private" }));
  expect(p.onAudience).toHaveBeenCalledWith("invite-only");
  // No explanatory copy under the segment on this page.
  expect(r.queryByText(/join straight in/)).toBeNull();
  fireEvent.press(r.getByLabelText("Default: show my numbers"));
  expect(p.onSharing).toHaveBeenCalledWith("numbers", false);
  fireEvent.press(r.getByLabelText("Default: let others fill in my sets"));
  expect(p.onSharing).toHaveBeenCalledWith("logging", true);
  expect(r.getByText("With everyone in the session")).toBeTruthy();
  expect(r.getByText("Off. Your code and QR work either way.")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Let people find me by name"));
  expect(p.onDiscoverable).toHaveBeenCalledWith(true);
  expect(r.getByText("3")).toBeTruthy();
  expect(r.getByText("2")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Training partners"));
  fireEvent.press(r.getByLabelText("Blocked people"));
  expect(p.onPartners).toHaveBeenCalledTimes(1);
  expect(p.onBlocked).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByLabelText("Back"));
  expect(p.onBack).toHaveBeenCalledTimes(1);
});

it("while the profile and counts load it shows placeholders, and a notice is an alert", () => {
  const r = renderWithTheme(
    <TogetherSettingsPresenter
      {...props()}
      discoverable={null}
      partnersCount={null}
      blockedCount={null}
      notice="Could not change that."
      busy
    />,
  );
  expect(r.queryByLabelText("Let people find me by name")).toBeNull();
  expect(r.getAllByText("…")).toHaveLength(3);
  expect(r.getByRole("alert")).toBeTruthy();
  expect(
    r.getByLabelText("Default: show my numbers").props.accessibilityState
      .disabled,
  ).toBe(true);
});

it("Blocked people lists everyone with Unblock, and says when nobody is blocked", () => {
  const onUnblock = jest.fn();
  const r = renderWithTheme(
    <TogetherBlockedPresenter
      people={[
        { userId: "a", name: "Alex Mori" },
        { userId: "b", name: "Blocked person" },
      ]}
      onUnblock={onUnblock}
      onBack={jest.fn()}
    />,
  );
  expect(r.getByText("Blocked people")).toBeTruthy();
  expect(r.getByText("Alex Mori")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Unblock Alex Mori"));
  expect(onUnblock).toHaveBeenCalledWith("a");
  r.rerender(
    <TogetherBlockedPresenter
      people={[]}
      onUnblock={onUnblock}
      onBack={jest.fn()}
    />,
  );
  expect(r.getByText("Nobody is blocked.")).toBeTruthy();
  r.rerender(
    <TogetherBlockedPresenter
      people={null}
      notice="Could not load blocked people."
      onUnblock={onUnblock}
      onBack={jest.fn()}
    />,
  );
  expect(r.getByText("Loading…")).toBeTruthy();
  expect(r.getByRole("alert")).toBeTruthy();
});
