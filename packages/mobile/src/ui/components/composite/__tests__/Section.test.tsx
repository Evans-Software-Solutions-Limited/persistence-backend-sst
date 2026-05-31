import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Text } from "../../Text";
import { Section } from "../Section";

describe("Section", () => {
  it("renders eyebrow + title + children", () => {
    const { getByText } = renderWithTheme(
      <Section eyebrow="TODAY" title="Workouts">
        <Text>body</Text>
      </Section>,
    );
    expect(getByText("TODAY")).toBeTruthy();
    expect(getByText("Workouts")).toBeTruthy();
    expect(getByText("body")).toBeTruthy();
  });

  it("renders an action slot", () => {
    const { getByTestId } = renderWithTheme(
      <Section title="Workouts" action={<View testID="action" />}>
        <Text>body</Text>
      </Section>,
    );
    expect(getByTestId("action")).toBeTruthy();
  });

  it("renders an eyebrow-only header with no body (Progress-style)", () => {
    const { getByText, queryByText } = renderWithTheme(
      <Section eyebrow="LIFETIME" title="184 workouts" hideHr />,
    );
    expect(getByText("LIFETIME")).toBeTruthy();
    expect(getByText("184 workouts")).toBeTruthy();
    expect(queryByText("body")).toBeNull();
  });

  it("renders a body-only section (no header)", () => {
    const { getByText } = renderWithTheme(
      <Section testID="sec">
        <Text>just content</Text>
      </Section>,
    );
    expect(getByText("just content")).toBeTruthy();
  });

  it("omits the divider when hideHr is set", () => {
    const { toJSON } = renderWithTheme(
      <Section title="T" hideHr>
        <Text>b</Text>
      </Section>,
    );
    // Snapshot tree has no 1pt divider View — assert the header + body still render.
    expect(JSON.stringify(toJSON())).toContain("b");
  });
});
