import { fireEvent } from "@testing-library/react-native";
import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { SearchBar } from "../SearchBar";

describe("SearchBar", () => {
  it("renders the placeholder + current value", () => {
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Search exercises"
        value="bench"
        onChangeText={() => undefined}
        testID="search"
      />,
    );
    const input = getByTestId("search-input");
    expect(input.props.value).toBe("bench");
    expect(input.props.placeholder).toBe("Search exercises");
  });

  it("fires onChangeText as the user types", () => {
    const onChangeText = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Search"
        value=""
        onChangeText={onChangeText}
        testID="search"
      />,
    );
    fireEvent.changeText(getByTestId("search-input"), "squat");
    expect(onChangeText).toHaveBeenCalledWith("squat");
  });

  it("fires onSubmit on submit", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Search"
        value="x"
        onChangeText={() => undefined}
        onSubmit={onSubmit}
        testID="search"
      />,
    );
    fireEvent(getByTestId("search-input"), "submitEditing");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders a trailing slot", () => {
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Search"
        value=""
        onChangeText={() => undefined}
        trailing={<View testID="filter" />}
      />,
    );
    expect(getByTestId("filter")).toBeTruthy();
  });

  it("defaults the input accessibilityLabel to the placeholder", () => {
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Find a client"
        value=""
        onChangeText={() => undefined}
        testID="search"
      />,
    );
    expect(getByTestId("search-input").props.accessibilityLabel).toBe(
      "Find a client",
    );
  });

  it("disables iOS autocapitalize + autocorrect (name-search fields)", () => {
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Search exercises"
        value=""
        onChangeText={() => undefined}
        testID="search"
      />,
    );
    const input = getByTestId("search-input");
    expect(input.props.autoCapitalize).toBe("none");
    expect(input.props.autoCorrect).toBe(false);
  });

  it("honours an explicit accessibilityLabel", () => {
    const { getByTestId } = renderWithTheme(
      <SearchBar
        placeholder="Search"
        value=""
        onChangeText={() => undefined}
        accessibilityLabel="Exercise search field"
        testID="search"
      />,
    );
    expect(getByTestId("search-input").props.accessibilityLabel).toBe(
      "Exercise search field",
    );
  });
});
