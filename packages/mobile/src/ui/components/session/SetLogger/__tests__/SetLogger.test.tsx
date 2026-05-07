import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { SetLogger } from "../SetLogger";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";
import type { ExerciseSet } from "@/domain/models/session";

const buildSet = (overrides: Partial<ExerciseSet> = {}): ExerciseSet => ({
  id: "set-1",
  sessionExerciseId: "se-1",
  setNumber: 1,
  weightKg: null,
  reps: null,
  rpe: null,
  durationSeconds: null,
  distanceMeters: null,
  isCompleted: false,
  completedAt: null,
  ...overrides,
});

describe("SetLogger", () => {
  it("renders the set number, previous hint, and three editable inputs", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={{ weightKg: 80, reps: 8 }}
        onChange={jest.fn()}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    expect(getByText("1")).toBeTruthy();
    expect(getByText("80kg × 8")).toBeTruthy();
    expect(getByTestId("set-logger-weight")).toBeTruthy();
    expect(getByTestId("set-logger-reps")).toBeTruthy();
    expect(getByTestId("set-logger-rpe")).toBeTruthy();
  });

  it("renders an em dash when no previous set is supplied", () => {
    const { getByText } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    expect(getByText("—")).toBeTruthy();
  });

  it("dispatches onChange with the parsed weight on text change", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-weight"), "82.5");
    expect(onChange).toHaveBeenCalledWith({ weightKg: 82.5 });
  });

  it("ignores invalid weight input (no onChange when text doesn't parse to a number)", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-weight"), "abc");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores invalid reps input + RPE outside 1-10 range", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-reps"), "abc");
    fireEvent.changeText(getByTestId("set-logger-rpe"), "11");
    fireEvent.changeText(getByTestId("set-logger-rpe"), "0");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears reps + RPE → null when their inputs are emptied", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet({ reps: 8, rpe: 7 })}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-reps"), "");
    expect(onChange).toHaveBeenCalledWith({ reps: null });
    fireEvent.changeText(getByTestId("set-logger-rpe"), "");
    expect(onChange).toHaveBeenCalledWith({ rpe: null });
  });

  it("dispatches { weightKg: null } when the weight input is cleared", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet({ weightKg: 80 })}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-weight"), "");
    expect(onChange).toHaveBeenCalledWith({ weightKg: null });
  });

  it("dispatches onChange with parsed reps", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-reps"), "8");
    expect(onChange).toHaveBeenCalledWith({ reps: 8 });
  });

  it("ignores out-of-range RPE values", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-rpe"), "12");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts an in-range RPE value", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-rpe"), "8");
    expect(onChange).toHaveBeenCalledWith({ rpe: 8 });
  });

  it("Mark Complete fires onComplete on uncompleted sets", () => {
    const onComplete = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
        onComplete={onComplete}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("set-logger-action"));
    expect(onComplete).toHaveBeenCalled();
  });

  it("Trash icon fires onRemove on completed sets", () => {
    const onRemove = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet({ isCompleted: true })}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
        onComplete={jest.fn()}
        onRemove={onRemove}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("set-logger-action"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("tap on previous-hint fires onFillPrevious", () => {
    const onFillPrevious = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={{ weightKg: 80, reps: 8 }}
        onChange={jest.fn()}
        onComplete={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={onFillPrevious}
      />,
    );
    fireEvent.press(getByTestId("set-logger-fill-previous"));
    expect(onFillPrevious).toHaveBeenCalled();
  });
});
