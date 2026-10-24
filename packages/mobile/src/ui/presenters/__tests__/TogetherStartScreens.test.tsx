import React from "react";
import { View } from "react-native";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherPickWorkoutPresenter } from "../TogetherPickWorkoutPresenter";
import { TogetherStartSessionPresenter } from "../TogetherStartSessionPresenter";
import { TogetherStartSheet } from "../TogetherStartSheet";
import {
  TogetherInvitePresenter,
  togetherInviteLine,
} from "../TogetherInvitePresenter";
import { TogetherJoinRequestBar } from "../TogetherJoinRequestBar";
jest.mock("@/ui/components/foundation/BottomSheet", () => ({
  BottomSheet: (props: {
    visible: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    props.visible ? (
      <>
        {props.children}
        {props.footer}
      </>
    ) : null,
}));
it("Pick a workout lists today's programme first, then your workouts, and selects by row", () => {
  const p = {
    today: [
      { id: "lower", name: "Lower Body B", meta: "3 exercises · about 50 min" },
    ],
    others: [
      { id: "push", name: "Push A", meta: "4 exercises · about 55 min" },
      { id: "pull", name: "Pull B", meta: "4 exercises" },
    ],
    selectedId: "push",
    onSelect: jest.fn(),
    onCreate: jest.fn(),
    onBack: jest.fn(),
  };
  const r = renderWithTheme(<TogetherPickWorkoutPresenter {...p} />);
  expect(r.getByText("Pick a workout")).toBeTruthy();
  expect(r.getByText("Today in your programme")).toBeTruthy();
  expect(r.getByText("Your workouts")).toBeTruthy();
  expect(
    r.getByRole("radio", { name: "Choose Push A" }).props.accessibilityState
      .checked,
  ).toBe(true);
  fireEvent.press(r.getByRole("radio", { name: "Choose Lower Body B" }));
  expect(p.onSelect).toHaveBeenCalledWith("lower");
  fireEvent.press(r.getByLabelText("Back"));
  expect(p.onBack).toHaveBeenCalled();
  r.rerender(<TogetherPickWorkoutPresenter {...p} today={[]} others={[]} />);
  expect(r.queryByText("Today in your programme")).toBeNull();
  fireEvent.press(r.getByText("Create a workout"));
  expect(p.onCreate).toHaveBeenCalled();
  r.rerender(
    <TogetherPickWorkoutPresenter {...p} today={[]} others={[]} loading />,
  );
  expect(r.getByText("Loading your workouts…")).toBeTruthy();
  expect(r.queryByText("Create a workout")).toBeNull();
});
it("Start a shared session asks mode and audience once and starts the chosen workout", () => {
  const p = {
    workoutName: "Lower Body B",
    workoutMeta: "3 exercises · about 50 min",
    onChangeWorkout: jest.fn(),
    connection: "local" as const,
    onConnectionChange: jest.fn(),
    onlineAvailable: true,
    audience: "friends" as const,
    onAudienceChange: jest.fn(),
    onStart: jest.fn(),
    onBack: jest.fn(),
  };
  const r = renderWithTheme(<TogetherStartSessionPresenter {...p} />);
  expect(r.getByText("Start a shared session")).toBeTruthy();
  expect(r.getByText("Starts Lower Body B now. Up to 4 people.")).toBeTruthy();
  fireEvent.press(r.getByText("Change"));
  expect(p.onChangeWorkout).toHaveBeenCalled();
  fireEvent.press(r.getByRole("radio", { name: "Online · internet required" }));
  expect(p.onConnectionChange).toHaveBeenCalledWith("online");
  fireEvent.press(r.getByRole("radio", { name: "Private" }));
  expect(p.onAudienceChange).toHaveBeenCalledWith("invite-only");
  fireEvent.press(r.getByText("Start workout together"));
  expect(p.onStart).toHaveBeenCalledTimes(1);
  r.rerender(
    <TogetherStartSessionPresenter
      {...p}
      connection="online"
      notice="Nope"
      busy
    />,
  );
  expect(
    r.getByRole("radio", { name: "Open nearby" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(r.getByText("Nope")).toBeTruthy();
});
it("the row 1b sheet presets, disables Open nearby under Online, and shows the Wi-Fi-off state", () => {
  const p = {
    visible: true,
    onClose: jest.fn(),
    connection: "local" as const,
    onConnectionChange: jest.fn(),
    onlineAvailable: true,
    audience: "friends" as const,
    onAudienceChange: jest.fn(),
    onOpenSettings: jest.fn(),
    onRetry: jest.fn(),
    onStart: jest.fn(),
  };
  const r = renderWithTheme(<TogetherStartSheet {...p} />);
  expect(r.getByText(/Picked from your Together settings/)).toBeTruthy();
  expect(r.getByText("How you connect")).toBeTruthy();
  expect(r.getByText("Who can join")).toBeTruthy();
  expect(
    r.getByRole("radio", { name: "Partners" }).props.accessibilityState.checked,
  ).toBe(true);
  fireEvent.press(r.getByText("Start the session"));
  expect(p.onStart).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByLabelText("Close"));
  expect(p.onClose).toHaveBeenCalledTimes(1);
  r.rerender(<TogetherStartSheet {...p} connection="online" />);
  expect(
    r.getByRole("radio", { name: "Open nearby" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  r.rerender(<TogetherStartSheet {...p} wifiOff />);
  expect(r.getByText(/Wi-Fi is off. Turn it on to host nearby/)).toBeTruthy();
  expect(r.queryByText("Start the session")).toBeNull();
  fireEvent.press(r.getByText("Open Settings"));
  fireEvent.press(r.getByText("Try again"));
  expect(p.onOpenSettings).toHaveBeenCalledTimes(1);
  expect(p.onRetry).toHaveBeenCalledTimes(1);
  r.rerender(<TogetherStartSheet {...p} notice="Could not start" busy />);
  expect(r.getByText("Could not start")).toBeTruthy();
  r.rerender(<TogetherStartSheet {...p} visible={false} />);
  expect(r.queryByText("How you connect")).toBeNull();
});
it("Invite people shows the QR, the mode line and Share, and names who is waiting", () => {
  const p = {
    qr: <View testID="qr" />,
    connection: "local" as const,
    onShare: jest.fn(),
    onClose: jest.fn(),
  };
  const r = renderWithTheme(
    <TogetherInvitePresenter {...p} audience="friends" code="4KQ928" />,
  );
  expect(r.getByText("Invite people")).toBeTruthy();
  expect(r.getByLabelText("Session QR code")).toBeTruthy();
  // The code under the QR, read aloud digit by digit for a screen reader.
  expect(r.getByText("4KQ-928")).toBeTruthy();
  expect(r.getByLabelText("Session code 4 K Q 9 2 8")).toBeTruthy();
  expect(
    r.getByText(
      "Nearby · no internet needed · training partners join straight in",
    ),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Share code"));
  fireEvent.press(r.getByLabelText("Close"));
  expect(p.onShare).toHaveBeenCalledTimes(1);
  expect(p.onClose).toHaveBeenCalledTimes(1);
  r.rerender(
    <TogetherInvitePresenter
      {...p}
      connection="online"
      audience="invite-only"
      pendingCount={1}
      notice="Slow"
    />,
  );
  expect(
    r.getByText("Online · internet required · only people with this QR"),
  ).toBeTruthy();
  expect(
    r.getByText("1 person is waiting for you to let them in"),
  ).toBeTruthy();
  expect(r.getByText("Slow")).toBeTruthy();
  r.rerender(<TogetherInvitePresenter {...p} pendingCount={2} />);
  expect(
    r.getByText("2 people are waiting for you to let them in"),
  ).toBeTruthy();
  expect(togetherInviteLine("local")).toMatch(
    /training partners join straight in/,
  );
});
it("the join request bar names the person and offers Let in / No", () => {
  const p = { name: "Kai Anand", onAdmit: jest.fn(), onDeny: jest.fn() };
  const r = renderWithTheme(<TogetherJoinRequestBar {...p} />);
  expect(r.getByText("Kai Anand wants to join")).toBeTruthy();
  expect(r.getByText("Not a training partner")).toBeTruthy();
  fireEvent.press(r.getByText("Let in"));
  fireEvent.press(r.getByText("No"));
  expect(p.onAdmit).toHaveBeenCalledTimes(1);
  expect(p.onDeny).toHaveBeenCalledTimes(1);
  r.rerender(<TogetherJoinRequestBar {...p} busy />);
  fireEvent.press(r.getByText("Let in"));
  expect(p.onAdmit).toHaveBeenCalledTimes(1);
});
