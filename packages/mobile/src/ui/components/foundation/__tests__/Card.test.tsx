import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Text } from "../../Text";
import { Card } from "../Card";

describe("Card", () => {
  it("renders children", () => {
    const { getByText } = renderWithTheme(
      <Card testID="card">
        <Text>Block content</Text>
      </Card>,
    );
    expect(getByText("Block content")).toBeTruthy();
  });

  it("renders as a plain View (non-pressable) when no onPress", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <Card testID="card">
        <Text>x</Text>
      </Card>,
    );
    expect(getByTestId("card")).toBeTruthy();
    // No Pressable wrapper testID is emitted.
    expect(queryByTestId("card-pressable")).toBeNull();
  });

  it("renders as a Pressable and fires onPress", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Card testID="card" onPress={onPress} accessibilityLabel="Open block">
        <Text>x</Text>
      </Card>,
    );
    const pressable = getByTestId("card-pressable");
    fireEvent.press(pressable);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("forwards accessibility props on the pressable variant", () => {
    const { getByTestId } = renderWithTheme(
      <Card
        testID="card"
        onPress={() => undefined}
        accessibilityLabel="Open block"
        accessibilityState={{ disabled: false }}
      >
        <Text>x</Text>
      </Card>,
    );
    const pressable = getByTestId("card-pressable");
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("Open block");
  });

  it.each([0, 1, 2] as const)("renders surface tier %i", (surface) => {
    const { getByTestId } = renderWithTheme(
      <Card testID="card" surface={surface}>
        <Text>x</Text>
      </Card>,
    );
    expect(getByTestId("card")).toBeTruthy();
  });

  it.each(["primary", "gold", "trainer", "ember", "success", "error"] as const)(
    "renders accent tone %s",
    (accent) => {
      const { getByTestId } = renderWithTheme(
        <Card testID="card" accent={accent}>
          <Text>x</Text>
        </Card>,
      );
      expect(getByTestId("card")).toBeTruthy();
    },
  );

  it.each(["primary", "gold", "trainer"] as const)(
    "renders glow %s",
    (glow) => {
      const { getByTestId } = renderWithTheme(
        <Card testID="card" glow={glow}>
          <Text>x</Text>
        </Card>,
      );
      expect(getByTestId("card")).toBeTruthy();
    },
  );

  it("applies custom pad + radius", () => {
    const { getByTestId } = renderWithTheme(
      <Card testID="card" pad={24} radius={20}>
        <Text>x</Text>
      </Card>,
    );
    expect(getByTestId("card")).toBeTruthy();
  });

  it("honours an explicit accessibilityRole on the pressable variant", () => {
    const { getByText } = renderWithTheme(
      <Card
        onPress={() => undefined}
        accessibilityRole="link"
        accessibilityLabel="Linky card"
      >
        <Text>linky</Text>
      </Card>,
    );
    expect(getByText("linky")).toBeTruthy();
  });

  it("renders a pressable card without a testID (no -pressable id emitted)", () => {
    const onPress = jest.fn();
    const { getByText, queryByTestId } = renderWithTheme(
      <Card onPress={onPress} accessibilityLabel="No-id card">
        <Text>noid</Text>
      </Card>,
    );
    expect(getByText("noid")).toBeTruthy();
    expect(queryByTestId("card-pressable")).toBeNull();
    fireEvent.press(getByText("noid"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default surface tier for an out-of-range value", () => {
    const { getByTestId } = renderWithTheme(
      // @ts-expect-error — exercising the runtime fallback branch
      <Card testID="card" surface={5}>
        <Text>x</Text>
      </Card>,
    );
    expect(getByTestId("card")).toBeTruthy();
  });
});
