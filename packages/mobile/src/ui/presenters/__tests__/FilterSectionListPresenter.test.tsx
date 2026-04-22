import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { FilterSectionListPresenter } from "../FilterSectionListPresenter";

describe("FilterSectionListPresenter", () => {
  it("renders every row's label and subtitle", () => {
    const { getByText } = renderWithTheme(
      <FilterSectionListPresenter
        rows={[
          {
            key: "muscles",
            label: "Muscle Groups",
            subtitle: "2 selected",
            onPress: () => {},
          },
          {
            key: "equipment",
            label: "Equipment",
            subtitle: "Any",
            onPress: () => {},
          },
        ]}
      />,
    );
    expect(getByText("Muscle Groups")).toBeTruthy();
    expect(getByText("2 selected")).toBeTruthy();
    expect(getByText("Equipment")).toBeTruthy();
    expect(getByText("Any")).toBeTruthy();
  });

  it("invokes onPress for the right row", () => {
    const onPressMuscles = jest.fn();
    const onPressEquipment = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FilterSectionListPresenter
        rows={[
          {
            key: "muscles",
            label: "Muscle Groups",
            subtitle: "Any",
            onPress: onPressMuscles,
          },
          {
            key: "equipment",
            label: "Equipment",
            subtitle: "Any",
            onPress: onPressEquipment,
          },
        ]}
      />,
    );
    fireEvent.press(getByTestId("filter-section-equipment"));
    expect(onPressEquipment).toHaveBeenCalledTimes(1);
    expect(onPressMuscles).not.toHaveBeenCalled();
  });

  it("renders zero rows gracefully (empty list)", () => {
    const { getByTestId } = renderWithTheme(
      <FilterSectionListPresenter rows={[]} />,
    );
    expect(getByTestId("filter-section-list")).toBeTruthy();
  });
});
