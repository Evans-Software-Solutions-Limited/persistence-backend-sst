import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { RepRange } from "../RepRange";

describe("RepRange", () => {
  it("renders the min/max values", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <RepRange
        min={8}
        max={12}
        onMin={jest.fn()}
        onMax={jest.fn()}
        minTestID="reps-min-input"
        maxTestID="reps-max-input"
      />,
    );
    expect(getByText("Rep range")).toBeTruthy();
    expect(getByTestId("reps-min-input").props.value).toBe("8");
    expect(getByTestId("reps-max-input").props.value).toBe("12");
  });

  it("fires onMin/onMax on keystroke and onMinBlur/onMaxBlur with the buffered text", () => {
    const onMin = jest.fn();
    const onMax = jest.fn();
    const onMinBlur = jest.fn();
    const onMaxBlur = jest.fn();
    const { getByTestId } = renderWithTheme(
      <RepRange
        min={8}
        max={12}
        onMin={onMin}
        onMax={onMax}
        onMinBlur={onMinBlur}
        onMaxBlur={onMaxBlur}
        minTestID="reps-min-input"
        maxTestID="reps-max-input"
      />,
    );

    fireEvent.changeText(getByTestId("reps-min-input"), "10");
    expect(onMin).toHaveBeenCalledWith("10");
    fireEvent(getByTestId("reps-min-input"), "blur");
    expect(onMinBlur).toHaveBeenCalledWith("10");

    fireEvent.changeText(getByTestId("reps-max-input"), "15");
    expect(onMax).toHaveBeenCalledWith("15");
    fireEvent(getByTestId("reps-max-input"), "blur");
    expect(onMaxBlur).toHaveBeenCalledWith("15");
  });

  it("keeps each buffer independent and empty-safe (no 0-flash) while mid-edit", () => {
    const { getByTestId } = renderWithTheme(
      <RepRange
        min={8}
        max={12}
        onMin={jest.fn()}
        onMax={jest.fn()}
        minTestID="reps-min-input"
        maxTestID="reps-max-input"
      />,
    );
    fireEvent.changeText(getByTestId("reps-min-input"), "");
    expect(getByTestId("reps-min-input").props.value).toBe("");
    expect(getByTestId("reps-max-input").props.value).toBe("12");
  });
});
