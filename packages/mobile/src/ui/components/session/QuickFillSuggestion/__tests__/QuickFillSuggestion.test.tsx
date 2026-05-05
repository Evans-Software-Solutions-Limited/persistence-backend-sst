import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { QuickFillSuggestion } from "../QuickFillSuggestion";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

describe("QuickFillSuggestion", () => {
  it("renders the formatted last-time hint and triggers onFill on press", () => {
    const onFill = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <QuickFillSuggestion weightKg={80} reps={8} onFill={onFill} />,
    );
    expect(getByText("Last time: 80kg × 8")).toBeTruthy();
    fireEvent.press(getByTestId("quickfill-suggestion"));
    expect(onFill).toHaveBeenCalled();
  });

  it("returns null when weightKg is missing", () => {
    const { queryByTestId } = renderWithTheme(
      <QuickFillSuggestion weightKg={null} reps={8} onFill={jest.fn()} />,
    );
    expect(queryByTestId("quickfill-suggestion")).toBeNull();
  });

  it("returns null when reps is missing", () => {
    const { queryByTestId } = renderWithTheme(
      <QuickFillSuggestion weightKg={80} reps={null} onFill={jest.fn()} />,
    );
    expect(queryByTestId("quickfill-suggestion")).toBeNull();
  });

  it("treats falsy-zero weight as a valid value (bodyweight set)", () => {
    const { getByText } = renderWithTheme(
      <QuickFillSuggestion weightKg={0} reps={20} onFill={jest.fn()} />,
    );
    expect(getByText("Last time: 0kg × 20")).toBeTruthy();
  });

  it("formats decimal weight with one fractional digit", () => {
    const { getByText } = renderWithTheme(
      <QuickFillSuggestion weightKg={62.5} reps={8} onFill={jest.fn()} />,
    );
    expect(getByText("Last time: 62.5kg × 8")).toBeTruthy();
  });
});
