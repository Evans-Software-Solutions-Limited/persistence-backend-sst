import { act, fireEvent } from "@testing-library/react-native";

import { CreateExerciseSheetPresenter } from "@/ui/presenters/CreateExerciseSheetPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

describe("CreateExerciseSheetPresenter", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing until the sheet is opened", () => {
    const { queryByTestId } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible={false}
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(queryByTestId("create-exercise-sheet")).toBeNull();
    expect(queryByTestId("create-exercise-save")).toBeNull();
  });

  it("renders the form, preview and footer when visible", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(getByTestId("create-exercise-sheet")).toBeTruthy();
    expect(getByTestId("exercise-form-name")).toBeTruthy();
    expect(getByText("PREVIEW")).toBeTruthy();
    expect(getByText("Your exercise name")).toBeTruthy();
    expect(getByText("Save exercise")).toBeTruthy();
  });

  it("does not submit while the name is empty", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submits the form value, shows 'Saved ✓', then closes after 700ms", async () => {
    jest.useFakeTimers();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Front Squat");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Front Squat" }),
    );
    expect(getByText("Saved ✓")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(700);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open and suppresses the affirmation when the save fails", async () => {
    const onSave = jest.fn().mockRejectedValue(new Error("offline"));
    const onClose = jest.fn();
    const { getByTestId, getByText, queryByText } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Squat");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(queryByText("Saved ✓")).toBeNull();
    expect(getByText("Save exercise")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes the sheet", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={onClose}
        onSave={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("create-exercise-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets the form when the sheet reopens", () => {
    const { getByTestId, rerender } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("exercise-form-name"), "Draft");
    expect(getByTestId("exercise-form-name").props.value).toBe("Draft");

    rerender(
      <CreateExerciseSheetPresenter
        visible={false}
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    rerender(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(getByTestId("exercise-form-name").props.value).toBe("");
  });

  it("renders live preview pills with secondary overflow", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    fireEvent.changeText(getByTestId("exercise-form-name"), "Thruster");
    fireEvent.press(getByTestId("exercise-form-secondary-Back"));
    fireEvent.press(getByTestId("exercise-form-secondary-Legs"));
    fireEvent.press(getByTestId("exercise-form-secondary-Shoulders"));

    expect(getByText("Thruster")).toBeTruthy();
    expect(getByText("CHEST")).toBeTruthy();
    expect(getByText("BARBELL")).toBeTruthy();
    expect(getByText("INTERMEDIATE")).toBeTruthy();
    expect(getByText("+1")).toBeTruthy();
  });

  it("ignores a rapid double-tap on Save (single submit, no duplicate)", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Squat");
    await act(async () => {
      // Two presses queued before the first `await onSave` yields — the
      // synchronous in-flight ref must reject the second.
      fireEvent.press(getByTestId("create-exercise-save"));
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("re-arms Save after a failed attempt so the user can retry", async () => {
    const onSave = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const { getByTestId } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Squat");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("clears the auto-close timer when the sheet closes before it fires", async () => {
    jest.useFakeTimers();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { getByTestId, rerender } = renderWithTheme(
      <CreateExerciseSheetPresenter
        visible
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Squat");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    // Sheet closes (e.g. pan-down) and reopens before the 700ms elapses.
    rerender(
      <CreateExerciseSheetPresenter
        visible={false}
        onClose={onClose}
        onSave={onSave}
      />,
    );
    rerender(
      <CreateExerciseSheetPresenter
        visible
        onClose={onClose}
        onSave={onSave}
      />,
    );
    onClose.mockClear();

    act(() => {
      jest.advanceTimersByTime(700);
    });

    // The stale timer was cancelled on close — it must NOT close the
    // freshly-reopened sheet.
    expect(onClose).not.toHaveBeenCalled();
  });
});
