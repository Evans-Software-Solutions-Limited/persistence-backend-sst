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
  it("renders the set number, previous hint, and reps + weight inputs", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={{ weightKg: 80, reps: 8 }}
        onChange={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    expect(getByText("1")).toBeTruthy();
    expect(getByText("8 reps • 80 kg")).toBeTruthy();
    expect(getByTestId("set-logger-reps")).toBeTruthy();
    expect(getByTestId("set-logger-weight")).toBeTruthy();
  });

  it("converts the previous-set chip to lb when weightUnit is lb (device-QA #8b)", () => {
    const { getByText } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={{ weightKg: 80, reps: 8 }}
        weightUnit="lb"
        onChange={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    // 80 kg -> 176.4 lb (weightInUnit, 1dp).
    expect(getByText("8 reps • 176.4 lb")).toBeTruthy();
  });

  it("renders an em dash when no previous set is supplied", () => {
    const { getByText } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
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
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-weight"), "82.5");
    expect(onChange).toHaveBeenCalledWith({ weightKg: 82.5 });
  });

  it("ignores invalid weight input (no onChange when text doesn't parse)", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-weight"), "abc");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores invalid reps input", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-reps"), "abc");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears reps → null when the input is emptied", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet({ reps: 8 })}
        setNumber={1}
        previous={null}
        onChange={onChange}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-reps"), "");
    expect(onChange).toHaveBeenCalledWith({ reps: null });
  });

  it("dispatches { weightKg: null } when the weight input is cleared", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet({ weightKg: 80 })}
        setNumber={1}
        previous={null}
        onChange={onChange}
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
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-reps"), "8");
    expect(onChange).toHaveBeenCalledWith({ reps: 8 });
  });

  it("logs cardio duration and converts metric distance to metres", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        trackingMode="cardio"
        preferredUnits="metric"
        onChange={onChange}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-duration"), "25:30");
    fireEvent.changeText(getByTestId("set-logger-distance"), "5");
    expect(onChange).toHaveBeenCalledWith({ durationSeconds: 1530 });
    expect(onChange).toHaveBeenCalledWith({ distanceMeters: 5000 });
  });

  it("converts an imperial plyometric jump distance to metres", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        trackingMode="plyometric"
        preferredUnits="imperial"
        onChange={onChange}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-distance"), "24");
    expect(onChange).toHaveBeenCalledWith({
      distanceMeters: expect.closeTo(0.6096, 8),
    });
  });

  it("hydrates metric values and clears invalid activity input", () => {
    const onChange = jest.fn();
    const baseProps = {
      set: buildSet(),
      setNumber: 1,
      previous: null,
      onChange,
      onRemove: jest.fn(),
      onFillPrevious: jest.fn(),
    };
    const { getByTestId, rerender } = renderWithTheme(
      <SetLogger
        {...baseProps}
        set={{ ...baseProps.set, durationSeconds: 90, distanceMeters: 5_000 }}
        trackingMode="cardio"
        onChange={onChange}
      />,
    );
    expect(getByTestId("set-logger-duration").props.value).toBe("1:30");
    expect(getByTestId("set-logger-distance").props.value).toBe("5");

    fireEvent.changeText(getByTestId("set-logger-duration"), "");
    expect(onChange).toHaveBeenCalledWith({ durationSeconds: null });
    fireEvent.changeText(getByTestId("set-logger-distance"), "");
    expect(onChange).toHaveBeenCalledWith({ distanceMeters: null });
    onChange.mockClear();
    fireEvent.changeText(getByTestId("set-logger-duration"), "1:99");
    fireEvent.changeText(getByTestId("set-logger-distance"), "1.2.3");
    expect(onChange).toHaveBeenNthCalledWith(1, { durationSeconds: null });
    expect(onChange).toHaveBeenNthCalledWith(2, { distanceMeters: null });

    rerender(
      <SetLogger
        {...baseProps}
        set={{ ...baseProps.set, distanceMeters: 0.6 }}
        trackingMode="plyometric"
        preferredUnits="metric"
        onChange={onChange}
      />,
    );
    expect(getByTestId("set-logger-distance").props.value).toBe("60");
  });

  it("trash icon always fires onRemove (no completion gating)", () => {
    const onRemove = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
        onRemove={onRemove}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("set-logger-remove"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("trash icon also fires onRemove on a completed set", () => {
    const onRemove = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet({ isCompleted: true, weightKg: 80, reps: 8 })}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
        onRemove={onRemove}
        onFillPrevious={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("set-logger-remove"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("submit on reps hops focus to weight, and submit on weight dismisses (no crash)", () => {
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={null}
        onChange={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={jest.fn()}
      />,
    );
    // Exercises the reps `onSubmitEditing` focus-hop + the weight
    // `onSubmitEditing={Keyboard.dismiss}` — both should run without throwing.
    expect(() => {
      fireEvent(getByTestId("set-logger-reps"), "submitEditing");
      fireEvent(getByTestId("set-logger-weight"), "submitEditing");
    }).not.toThrow();
  });

  it("tap on previous-hint fires onFillPrevious", () => {
    const onFillPrevious = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetLogger
        set={buildSet()}
        setNumber={1}
        previous={{ weightKg: 80, reps: 8 }}
        onChange={jest.fn()}
        onRemove={jest.fn()}
        onFillPrevious={onFillPrevious}
      />,
    );
    fireEvent.press(getByTestId("set-logger-fill-previous"));
    expect(onFillPrevious).toHaveBeenCalled();
  });
});
