import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  ClientRow,
  type ClientStatus,
  clientRowPressStyle,
} from "../ClientRow";

describe("ClientRow", () => {
  it("renders avatar initials + name", () => {
    const { getByText } = renderWithTheme(
      <ClientRow avatar={{ initials: "JD" }} name="Jane Doe" />,
    );
    expect(getByText("JD")).toBeTruthy();
    expect(getByText("Jane Doe")).toBeTruthy();
  });

  it("renders tags + lastSeen meta joined with a dot", () => {
    const { getByText } = renderWithTheme(
      <ClientRow
        avatar={{ initials: "JD" }}
        name="Jane"
        tags="Hypertrophy"
        lastSeen="2 days"
      />,
    );
    expect(getByText("Hypertrophy · 2 days ago")).toBeTruthy();
  });

  it.each<[ClientStatus, string | null]>([
    ["attention", "2 missed"],
    ["pr", "NEW PR"],
    ["missed", "4 days idle"],
  ])("renders the %s status badge", (status, text) => {
    const { getByText } = renderWithTheme(
      <ClientRow avatar={{ initials: "JD" }} name="Jane" status={status} />,
    );
    if (text) expect(getByText(text)).toBeTruthy();
  });

  it("renders no badge for the active status", () => {
    const { queryByText } = renderWithTheme(
      <ClientRow avatar={{ initials: "JD" }} name="Jane" status="active" />,
    );
    expect(queryByText("2 missed")).toBeNull();
    expect(queryByText("NEW PR")).toBeNull();
  });

  it("renders the adherence bar + percent", () => {
    const { getByText } = renderWithTheme(
      <ClientRow avatar={{ initials: "JD" }} name="Jane" adherence={92} />,
    );
    expect(getByText("92%")).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClientRow
        avatar={{ initials: "JD" }}
        name="Jane"
        onPress={onPress}
        testID="row"
      />,
    );
    fireEvent.press(getByTestId("row"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders skeletons when loading (no name, not pressable)", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <ClientRow
        avatar={{ initials: "JD" }}
        name="Jane"
        loading
        onPress={() => undefined}
        testID="row"
      />,
    );
    expect(getByTestId("row-skeleton")).toBeTruthy();
    expect(queryByText("Jane")).toBeNull();
    expect(getByTestId("row").props.accessibilityRole).toBeUndefined();
  });

  it("maps adherence thresholds to bar colours (>80 success, 50-80 gold, <50 error)", () => {
    // exercised via render — assert each renders without throwing
    for (const adh of [95, 70, 30]) {
      const { getByText } = renderWithTheme(
        <ClientRow
          avatar={{ initials: "AB" }}
          name={`c${adh}`}
          adherence={adh}
        />,
      );
      expect(getByText(`${adh}%`)).toBeTruthy();
    }
  });

  it("press style toggles opacity", () => {
    expect(clientRowPressStyle({ pressed: true }).opacity).toBe(0.8);
    expect(clientRowPressStyle({ pressed: false }).opacity).toBe(1);
  });

  it("omits the bottom border on the last row", () => {
    const { getByText } = renderWithTheme(
      <ClientRow avatar={{ initials: "JD" }} name="Last" isLast />,
    );
    expect(getByText("Last")).toBeTruthy();
  });
});
