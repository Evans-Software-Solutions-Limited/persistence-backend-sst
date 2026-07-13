import { Text } from "@tamagui/core";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Field } from "../Field";

describe("Field", () => {
  it("renders the label and children", () => {
    const { getByText } = renderWithTheme(
      <Field label="Workout name">
        <Text>child content</Text>
      </Field>,
    );
    expect(getByText("Workout name")).toBeTruthy();
    expect(getByText("child content")).toBeTruthy();
  });

  it("renders the required marker", () => {
    const { getByText } = renderWithTheme(
      <Field label="Workout name" required>
        <Text>child</Text>
      </Field>,
    );
    expect(getByText("Workout name *")).toBeTruthy();
  });

  it("renders the optional marker", () => {
    const { getByText } = renderWithTheme(
      <Field label="Description" optional>
        <Text>child</Text>
      </Field>,
    );
    expect(getByText("Description · optional")).toBeTruthy();
  });

  it("renders neither marker by default", () => {
    const { queryByText } = renderWithTheme(
      <Field label="Visibility">
        <Text>child</Text>
      </Field>,
    );
    expect(queryByText("Visibility *")).toBeNull();
    expect(queryByText("Visibility · optional")).toBeNull();
  });
});
