import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  MealSwapFeedback,
  type MealSwapFeedbackProps,
} from "../MealSwapFeedback";

function props(
  over: Partial<MealSwapFeedbackProps> = {},
): MealSwapFeedbackProps {
  return {
    mealId: "meal-1",
    value: "",
    onChange: jest.fn(),
    onGenerate: jest.fn(),
    onCancel: jest.fn(),
    busy: false,
    error: null,
    ...over,
  };
}

it("offers editable presets and explicit generation or cancellation", () => {
  const input = props();
  const view = renderWithTheme(<MealSwapFeedback {...input} />);
  fireEvent.press(view.getByLabelText("Quick to make"));
  expect(input.onChange).toHaveBeenCalledWith("Quick to make");
  fireEvent.changeText(view.getByLabelText("Swap feedback"), "Less rice");
  expect(input.onChange).toHaveBeenCalledWith("Less rice");
  expect(input.onGenerate).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId("meal-swap-feedback-generate"));
  expect(input.onGenerate).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByTestId("meal-swap-feedback-cancel"));
  expect(input.onCancel).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText("Swap feedback").props.maxLength).toBe(200);
});

it("disables editing and duplicate requests while busy", () => {
  const input = props({ busy: true, value: "High protein" });
  const view = renderWithTheme(<MealSwapFeedback {...input} />);
  fireEvent.press(view.getByTestId("meal-swap-feedback-generate"));
  fireEvent.press(view.getByTestId("meal-swap-feedback-cancel"));
  fireEvent.press(view.getByLabelText("Quick to make"));
  expect(input.onGenerate).not.toHaveBeenCalled();
  expect(input.onCancel).not.toHaveBeenCalled();
  expect(input.onChange).not.toHaveBeenCalled();
  expect(view.getByLabelText("Swap feedback").props.editable).toBe(false);
  expect(view.getByText("Finding a replacement…")).toBeTruthy();
});

it("shows a retryable error alongside the retained feedback", () => {
  const view = renderWithTheme(
    <MealSwapFeedback {...props({ value: "Less rice", error: "Try again" })} />,
  );
  expect(view.getByText("Try again")).toBeTruthy();
  expect(view.getByLabelText("Swap feedback").props.value).toBe("Less rice");
});
