import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { WeekFreq } from "../HabitControls";

/**
 * QA-8 (device-QA batch, BRIEF-7): the "days to hit" pips had a ~13×24px tap
 * target with no hitSlop. Asserts each pip carries a hitSlop that expands the
 * effective target without touching the visual pip size.
 */
describe("WeekFreq", () => {
  it("gives every day pip a hitSlop (without changing the pip's own size)", () => {
    const { getByTestId } = renderWithTheme(
      <WeekFreq value={3} tone="primary" onChange={jest.fn()} testID="freq" />,
    );
    for (let n = 1; n <= 7; n++) {
      const pip = getByTestId(`freq-pip-${n}`);
      expect(pip.props.hitSlop).toEqual({
        top: 10,
        bottom: 10,
        left: 4,
        right: 4,
      });
    }
  });

  it("fires onChange with the tapped day count", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WeekFreq value={3} tone="primary" onChange={onChange} testID="freq" />,
    );
    fireEvent.press(getByTestId("freq-pip-5"));
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
