import { useState } from "react";
import { fireEvent } from "@testing-library/react-native";
import type { FormTrigger, RuleFields } from "@/domain/models/coachForms";
import { defaultRule } from "@/domain/services/coachForms.service";
import { RuleFieldsPresenter } from "../RuleFieldsPresenter";
import {
  ChoiceChips,
  EyebrowHead,
  InDevelopment,
  ListRow,
  StatusPill,
} from "../kit";
import { FormPickerSheetPresenter } from "../ClientSetupSheetPresenter";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const changes: RuleFields[] = [];

function Harness(p: { trigger: FormTrigger; initial?: RuleFields }) {
  const [rule, setRule] = useState<RuleFields>(
    p.initial ?? defaultRule(p.trigger),
  );
  return (
    <RuleFieldsPresenter
      trigger={p.trigger}
      rule={rule}
      onChange={(r) => {
        changes.push(r);
        setRule(r);
      }}
    />
  );
}

const last = () => changes.at(-1)!;

beforeEach(() => {
  changes.length = 0;
});

describe("RuleFieldsPresenter (C10h/C10j day, time, due, reminders)", () => {
  it("weekly: day chips, time, due as day + time, reminders as weekday + time", () => {
    const view = renderWithTheme(<Harness trigger="weekly" />);
    expect(view.getByText("Mon 12:00")).toBeTruthy();
    expect(view.getByText("Sunday 18:00")).toBeTruthy();
    expect(view.getByText("Monday 09:00")).toBeTruthy();

    fireEvent.press(view.getByTestId("rule-day-6"));
    expect(last().weekday).toBe(6);
    fireEvent.press(view.getByTestId("rule-day-7"));

    // A half-typed time isn't saved; a whole one is.
    fireEvent.changeText(view.getByTestId("rule-time"), "1");
    expect(last().timeLocal).toBe("09:00");
    fireEvent.changeText(view.getByTestId("rule-time"), "10:00");
    expect(last().timeLocal).toBe("10:00");
    fireEvent.changeText(view.getByTestId("rule-time"), "09:00");

    // Due: Tue, then an hour later, then an hour earlier → Tue 12:00 = 51 h.
    fireEvent.press(view.getByTestId("rule-due"));
    fireEvent.press(view.getByTestId("rule-due-editor-day-2"));
    expect(last().dueAfterHours).toBe(51);
    fireEvent.press(view.getByTestId("rule-due-editor-hour-plus"));
    expect(last().dueAfterHours).toBe(52);
    expect(view.getByTestId("rule-due-editor-hour-value").props.children).toBe(
      "13:00",
    );
    fireEvent.press(view.getByTestId("rule-due-editor-hour-minus"));
    expect(view.getByText("Tue 12:00")).toBeTruthy();
    fireEvent.press(view.getByTestId("rule-due-editor-done"));
    expect(view.queryByTestId("rule-due-editor")).toBeNull();

    // Edit a reminder: Sunday 18:00 → Sunday 19:00.
    fireEvent.press(view.getByTestId("rule-reminder-0"));
    fireEvent.press(view.getByTestId("rule-reminder-editor-hour-plus"));
    expect(last().reminders).toEqual([{ afterHours: 10 }, { afterHours: 24 }]);
    expect(view.getByText("Sunday 19:00")).toBeTruthy();
    fireEvent.press(view.getByTestId("rule-reminder-editor-done"));
    // Tap again to close without changing.
    fireEvent.press(view.getByTestId("rule-reminder-1"));
    fireEvent.press(view.getByTestId("rule-reminder-1"));
    expect(view.queryByTestId("rule-reminder-editor")).toBeNull();

    // Remove one, add up to five, then + Add reminder stops.
    fireEvent.press(view.getByTestId("rule-reminder-0-remove"));
    expect(last().reminders).toEqual([{ afterHours: 24 }]);
    for (let i = 0; i < 4; i++)
      fireEvent.press(view.getByTestId("rule-add-reminder"));
    expect(last().reminders).toHaveLength(5);
    const before = changes.length;
    fireEvent.press(view.getByTestId("rule-add-reminder"));
    expect(changes.length).toBe(before);
  });

  it("daily: same day / next day + hour", () => {
    const view = renderWithTheme(<Harness trigger="daily" />);
    expect(view.getByText("Same day 12:00")).toBeTruthy();
    fireEvent.press(view.getByTestId("rule-due"));
    fireEvent.press(view.getByTestId("rule-due-editor-dayoffset-1"));
    expect(last().dueAfterHours).toBe(28);
    expect(view.getByText("Next day 12:00")).toBeTruthy();
    fireEvent.press(view.getByTestId("rule-due-editor-dayoffset-0"));
    expect(last().dueAfterHours).toBe(4);
    // Toggle the editor shut from the field.
    fireEvent.press(view.getByTestId("rule-due"));
    expect(view.queryByTestId("rule-due-editor")).toBeNull();
    expect(view.queryByTestId("rule-day")).toBeNull();
    // A first reminder lands before the due time.
    fireEvent.press(view.getByTestId("rule-add-reminder"));
    expect(last().reminders).toEqual([{ afterHours: 1 }]);
  });

  it("once with no due date: a reminder starts a day in", () => {
    const view = renderWithTheme(<Harness trigger="once" />);
    expect(view.getByText("No due date")).toBeTruthy();
    expect(view.queryByTestId("rule-time")).toBeNull();
    fireEvent.press(view.getByTestId("rule-add-reminder"));
    expect(last().reminders).toEqual([{ afterHours: 21 }]);
    expect(view.getByText("21 hours after it's sent")).toBeTruthy();
    fireEvent.press(view.getByTestId("rule-add-reminder"));
    expect(last().reminders).toEqual([{ afterHours: 21 }, { afterHours: 33 }]);
  });
});

describe("kit pieces", () => {
  it("rows, pills, heads, chips, placeholders", () => {
    const onPress = jest.fn();
    const onAdd = jest.fn();
    const onChange = jest.fn();
    const view = renderWithTheme(
      <>
        <ListRow title="Plain" testID="plain" />
        <ListRow
          title="Tap"
          subtitle="Late"
          subtitleTone="warn"
          onPress={onPress}
          testID="tap"
        />
        <StatusPill tone="paused" text="Paused" />
        <EyebrowHead title="History" />
        <EyebrowHead title="Sent to" onAdd={onAdd} testID="head" />
        <ChoiceChips
          label="Type"
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
          value="a"
          onChange={onChange}
        />
        <InDevelopment title="Photos" />
      </>,
    );
    fireEvent.press(view.getByTestId("tap"));
    fireEvent.press(view.getByTestId("head-add"));
    fireEvent.press(view.getByText("B"));
    expect(onPress).toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("b");
    expect(
      view.getByText("In development. Not in this build yet."),
    ).toBeTruthy();
  });

  it("the form picker's empty library", () => {
    const view = renderWithTheme(
      <FormPickerSheetPresenter
        visible
        onClose={jest.fn()}
        firstName="Sam"
        forms={[]}
        onPick={jest.fn()}
        onNewForm={jest.fn()}
      />,
    );
    expect(view.getByTestId("form-picker-empty")).toBeTruthy();
  });
});
