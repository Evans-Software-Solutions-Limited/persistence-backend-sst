import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { FilterAxisDetailPresenter } from "../FilterAxisDetailPresenter";

const items = [
  { key: "chest", label: "Chest" },
  { key: "back", label: "Back" },
  { key: "legs", label: "Legs" },
];

describe("FilterAxisDetailPresenter", () => {
  it("renders each item's label", () => {
    const { getByText } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={() => {}}
        testID="filter-test"
      />,
    );
    expect(getByText("Chest")).toBeTruthy();
    expect(getByText("Back")).toBeTruthy();
    expect(getByText("Legs")).toBeTruthy();
  });

  it("invokes onToggle with the correct key when a row is tapped", () => {
    const onToggle = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={onToggle}
        testID="filter-test"
      />,
    );
    fireEvent.press(getByTestId("filter-test-row-back"));
    expect(onToggle).toHaveBeenCalledWith("back");
  });

  it("sets accessibility state based on selection", () => {
    const { getByTestId } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={["chest"]}
        onToggle={() => {}}
        testID="filter-test"
      />,
    );
    expect(
      getByTestId("filter-test-row-chest").props.accessibilityState.checked,
    ).toBe(true);
    expect(
      getByTestId("filter-test-row-back").props.accessibilityState.checked,
    ).toBe(false);
  });

  it("renders the search bar only when searchable", () => {
    const { queryByTestId, rerender } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={() => {}}
        testID="filter-test"
      />,
    );
    expect(queryByTestId("filter-test-search")).toBeNull();

    rerender(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={() => {}}
        searchable
        searchValue=""
        onSearchChange={() => {}}
        testID="filter-test"
      />,
    );
    expect(queryByTestId("filter-test-search")).toBeTruthy();
  });

  it("filters items to matches when search is non-empty", () => {
    const { queryByText, rerender } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={() => {}}
        searchable
        searchValue=""
        onSearchChange={() => {}}
        testID="filter-test"
      />,
    );
    expect(queryByText("Chest")).toBeTruthy();
    expect(queryByText("Back")).toBeTruthy();

    rerender(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={() => {}}
        searchable
        searchValue="che"
        onSearchChange={() => {}}
        testID="filter-test"
      />,
    );
    expect(queryByText("Chest")).toBeTruthy();
    expect(queryByText("Back")).toBeNull();
    expect(queryByText("Legs")).toBeNull();
  });

  it("shows 'No matches' when the search finds nothing", () => {
    const { getByText } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={items}
        selectedKeys={[]}
        onToggle={() => {}}
        searchable
        searchValue="xyzzy"
        onSearchChange={() => {}}
        testID="filter-test"
      />,
    );
    expect(getByText("No matches")).toBeTruthy();
  });

  it("also matches against sublabel when searching", () => {
    const { queryByText } = renderWithTheme(
      <FilterAxisDetailPresenter
        items={[
          { key: "mine", label: "Mine", sublabel: "Exercises I made" },
          { key: "system", label: "System", sublabel: "Stock exercises" },
        ]}
        selectedKeys={[]}
        onToggle={() => {}}
        searchable
        searchValue="stock"
        onSearchChange={() => {}}
        testID="filter-test"
      />,
    );
    expect(queryByText("System")).toBeTruthy();
    expect(queryByText("Mine")).toBeNull();
  });
});
