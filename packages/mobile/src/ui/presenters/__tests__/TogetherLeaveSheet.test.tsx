import { fireEvent } from "@testing-library/react-native";
import React from "react";
import {
  TogetherLeaveSheet,
  hostEndedCopy,
  leftCopy,
  loggedSets,
  unsentFor,
} from "../TogetherLeaveSheet";
import { TogetherToast } from "../TogetherToast";
import { TogetherFinishChoicePresenter } from "../TogetherFinishChoicePresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { IconX } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

jest.mock("@/ui/components/foundation/BottomSheet", () => ({
  BottomSheet: (p: {
    visible: boolean;
    children: React.ReactNode;
    height?: number;
  }) => (p.visible ? <>{p.children}</> : null),
}));

const base = {
  visible: true,
  hostName: "Brad",
  others: ["Brad", "Tom", "Inés"],
  loggedSets: 6,
  onStay: jest.fn(),
  onConfirm: jest.fn(),
};

describe("TogetherLeaveSheet", () => {
  it("guest: one sentence, Stay and an orange Leave", () => {
    const r = renderWithTheme(<TogetherLeaveSheet {...base} role="guest" />);
    expect(r.getByText("Leave Brad’s session?")).toBeTruthy();
    expect(
      r.getByText(
        "Your workout carries on here with your 6 logged sets. Brad, Tom and Inés keep training.",
      ),
    ).toBeTruthy();
    expect(r.queryByTestId("together-leave-unsent")).toBeNull();
    fireEvent.press(r.getByText("Stay"));
    fireEvent.press(r.getByText("Leave"));
    fireEvent.press(r.getByLabelText("Close"));
    expect(base.onStay).toHaveBeenCalledTimes(2);
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("draws the close icon in the pill's $text2, not black (TestFlight, 31 Oct)", () => {
    const r = renderWithTheme(<TogetherLeaveSheet {...base} role="guest" />);
    expect(r.UNSAFE_getByType(IconX).props.color).toBe(color.$text2);
  });

  it("guest with one set and one partner reads in the singular", () => {
    const r = renderWithTheme(
      <TogetherLeaveSheet
        {...base}
        role="guest"
        others={["Brad"]}
        loggedSets={1}
      />,
    );
    expect(
      r.getByText(
        "Your workout carries on here with your 1 logged set. Brad keeps training.",
      ),
    ).toBeTruthy();
  });

  it("guest alone with nothing logged", () => {
    const r = renderWithTheme(
      <TogetherLeaveSheet {...base} role="guest" others={[]} loggedSets={0} />,
    );
    expect(r.getByText("Your workout carries on here.")).toBeTruthy();
  });

  it("guest with an unsent set is warned", () => {
    const r = renderWithTheme(
      <TogetherLeaveSheet
        {...base}
        role="guest"
        unsent={{ count: 1, names: ["Brad"] }}
      />,
    );
    expect(
      r.getByText(
        "1 set hasn’t reached Brad yet. If you leave now, it won’t be sent.",
      ),
    ).toBeTruthy();
  });

  it("host: End the live session with Keep it live", () => {
    const r = renderWithTheme(
      <TogetherLeaveSheet
        {...base}
        role="host"
        unsent={{ count: 0, names: [] }}
      />,
    );
    expect(r.getByText("End the live session?")).toBeTruthy();
    expect(
      r.getByText(
        "Everyone keeps their own workout and carries on solo. Nobody new can join.",
      ),
    ).toBeTruthy();
    expect(r.getByText("Keep it live")).toBeTruthy();
    expect(r.getByText("End session")).toBeTruthy();
    expect(r.queryByTestId("together-leave-unsent")).toBeNull();
  });

  it("host with unsent sets to two partners", () => {
    const r = renderWithTheme(
      <TogetherLeaveSheet
        {...base}
        role="host"
        unsent={{ count: 3, names: ["Mia", "Tom"] }}
      />,
    );
    expect(
      r.getByText(
        "3 sets haven’t reached Mia and Tom yet. If you end now, they won’t be sent.",
      ),
    ).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    const r = renderWithTheme(
      <TogetherLeaveSheet {...base} role="host" visible={false} />,
    );
    expect(r.queryByText("End the live session?")).toBeNull();
  });
});

describe("row 3 copy", () => {
  it("counts completed sets only", () => {
    const set = (isCompleted: boolean) => ({ isCompleted }) as never;
    expect(
      loggedSets({
        exercises: [{ sets: [set(true), set(false), set(true)] }],
      } as never),
    ).toBe(2);
    expect(loggedSets(null)).toBe(0);
  });

  it("words the toasts", () => {
    expect(leftCopy("Brad", 6)).toBe(
      "You left Brad’s session. Your 6 sets are here.",
    );
    expect(leftCopy("Brad", 1)).toBe(
      "You left Brad’s session. Your 1 set is here.",
    );
    expect(leftCopy("Brad", 0)).toBe(
      "You left Brad’s session. Your workout carries on.",
    );
    expect(hostEndedCopy("Brad")).toBe(
      "Brad ended the live session. Your workout carries on.",
    );
  });

  it("totals unsent sets across partners", () => {
    const name = (id: string) => ({ m: "Mia", t: "Tom" })[id]!;
    expect(unsentFor([], name, ["m"])).toBeNull();
    expect(
      unsentFor(
        [
          { ownerId: "m", count: 2 },
          { ownerId: "t", count: 1 },
        ],
        name,
        ["m", "t"],
      ),
    ).toEqual({ count: 3, names: ["Mia", "Tom"] });
  });

  it("leaves out partners who are no longer in the session", () => {
    const name = (id: string) => ({ m: "Mia" })[id] ?? "Athlete 0";
    const rows = [
      { ownerId: "m", count: 1 },
      { ownerId: "gone", count: 2 },
    ];
    expect(unsentFor(rows, name, ["m"])).toEqual({
      count: 1,
      names: ["Mia"],
    });
    expect(unsentFor(rows.slice(1), name, ["m"])).toBeNull();
  });
});

describe("TogetherToast", () => {
  it("shows a line, or nothing", () => {
    const r = renderWithTheme(
      <TogetherToast message="Live session ended. Your workout carries on." />,
    );
    expect(
      r.getByText("Live session ended. Your workout carries on."),
    ).toBeTruthy();
    r.rerender(<TogetherToast message={null} />);
    expect(r.queryByTestId("together-toast")).toBeNull();
  });
});

describe("TogetherFinishChoicePresenter", () => {
  it("is two choices and nothing else", () => {
    const p = {
      visible: true,
      onCancel: jest.fn(),
      onFinishAll: jest.fn(),
      onFinishOwn: jest.fn(),
    };
    const r = renderWithTheme(<TogetherFinishChoicePresenter {...p} />);
    expect(r.getByText("Finish workout?")).toBeTruthy();
    expect(
      r.getByText("Everyone rates and saves their own result."),
    ).toBeTruthy();
    expect(r.queryByText("Discard without saving")).toBeNull();
    expect(r.queryByText("Keep training")).toBeNull();
    fireEvent.press(r.getByText("Finish for all"));
    fireEvent.press(r.getByText("Finish just for me"));
    expect(p.onFinishAll).toHaveBeenCalled();
    expect(p.onFinishOwn).toHaveBeenCalled();
  });
});
