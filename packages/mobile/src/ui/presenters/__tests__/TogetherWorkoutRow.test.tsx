import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherWorkoutRow, togetherMemberTone } from "../TogetherWorkoutRow";
import { TogetherAthleteAvatar } from "../TogetherAthleteAvatar";
import { TogetherStartRow } from "../TogetherStartRow";
import { TogetherPill } from "../TogetherPill";
import {
  IconCheck,
  IconSettings,
  IconX,
  iconDefaults,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
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
  const mine = r.getByLabelText("Show my workout");
  expect(mine.props.accessibilityRole).toBe("tab");
  expect(mine.props.accessibilityState.selected).toBe(true);
  fireEvent.press(r.getByLabelText("Show Mia Osei’s workout"));
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
    r.getByLabelText("Show Mia Osei’s workout").props.accessibilityState
      .selected,
  ).toBe(true);
  expect(
    r.getByLabelText("Show my workout").props.accessibilityState.selected,
  ).toBe(false);
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
it("partner tones follow roster order without me; tabs are 44pt targets (row 2)", () => {
  expect(togetherMemberTone(members, "me", "me")).toBe("primary");
  expect(togetherMemberTone(members, "me", "mia")).toBe("info");
  expect(togetherMemberTone(members, "me", "tom")).toBe("success");
  expect(togetherMemberTone(members, "mia", "me")).toBe("info");
  expect(togetherMemberTone(members, "me", "gone")).toBe("info");
  const r = renderWithTheme(
    <TogetherWorkoutRow
      members={members}
      selectedId="me"
      accountId="me"
      status="In sync · 3 training"
      onSelect={() => {}}
      onSettings={() => {}}
      onEnd={() => {}}
    />,
  );
  // 26pt face + 9pt slop each side.
  expect(r.getByLabelText("Show Tom Vance’s workout").props.hitSlop).toBe(9);
});
it("the settings cog and close glyphs take the pill's colour, never currentColor (black on a device)", () => {
  const r = renderWithTheme(
    <TogetherWorkoutRow
      members={members}
      selectedId="mia"
      accountId="me"
      status="In sync · 3 training"
      onSelect={() => {}}
      onSettings={() => {}}
      onEnd={() => {}}
    />,
  );
  expect(r.UNSAFE_getByType(IconSettings).props.color).toBe(color.$text2);
  // A primary pill's glyph is ink; a colour the caller chose is kept.
  const pills = renderWithTheme(
    <>
      <TogetherPill
        tone="primary"
        onPress={() => {}}
        icon={<IconX {...iconDefaults({ size: 16 })} />}
      />
      <TogetherPill
        onPress={() => {}}
        icon={<IconCheck {...iconDefaults({ size: 16 })} color="#FF0000" />}
      />
    </>,
  );
  expect(pills.UNSAFE_getByType(IconX).props.color).toBe(color.$primaryInk);
  expect(pills.UNSAFE_getByType(IconCheck).props.color).toBe("#FF0000");
});

it("keeps a partner's colour when an earlier partner drops off the strip (inspector lead)", () => {
  const p = {
    selectedId: "me",
    accountId: "me",
    status: "In sync · 2 training",
    onSelect: jest.fn(),
    onSettings: jest.fn(),
    onEnd: jest.fn(),
  };
  const toneOf = (r: ReturnType<typeof renderWithTheme>, name: string) =>
    r
      .UNSAFE_getAllByType(TogetherAthleteAvatar)
      .find((a) => a.props.name === name)!.props.tone;
  const before = renderWithTheme(
    <TogetherWorkoutRow {...p} members={members} />,
  );
  const tom = toneOf(before, "Tom Vance");
  // Mia finished: she drops off the strip, but Tom keeps his colour.
  const after = renderWithTheme(
    <TogetherWorkoutRow
      {...p}
      members={members.filter((m) => m.userId !== "mia")}
      toneMembers={members}
    />,
  );
  expect(toneOf(after, "Tom Vance")).toBe(tom);
});
