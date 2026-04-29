import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { WorkoutSection } from "@/ui/components/workouts/WorkoutSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("WorkoutSection", () => {
  it("renders title + subtitle and starts expanded", () => {
    const { getByText } = renderWithTheme(
      <WorkoutSection title="My Workouts" subtitle="2 workouts">
        <Text>Child content</Text>
      </WorkoutSection>,
    );
    expect(getByText("My Workouts")).toBeTruthy();
    expect(getByText("2 workouts")).toBeTruthy();
    expect(getByText("Child content")).toBeTruthy();
  });

  it("collapses when the header is tapped", () => {
    const { getByText, queryByText } = renderWithTheme(
      <WorkoutSection title="Section">
        <Text>Hidden when collapsed</Text>
      </WorkoutSection>,
    );
    fireEvent.press(getByText("Section"));
    expect(queryByText("Hidden when collapsed")).toBeNull();
  });

  it("renders the loading splash when isLoading is true", () => {
    const { getByText } = renderWithTheme(
      <WorkoutSection title="Loading section" isLoading>
        <Text>Should not appear</Text>
      </WorkoutSection>,
    );
    expect(getByText("Loading workouts...")).toBeTruthy();
  });

  it("renders the empty state with custom title + message", () => {
    const { getByText } = renderWithTheme(
      <WorkoutSection
        title="Empty section"
        isEmpty
        emptyTitle="Nothing here"
        emptyMessage="Try the picker above"
        emptyIcon="folder-open-outline"
      >
        <Text>Should not appear</Text>
      </WorkoutSection>,
    );
    expect(getByText("Nothing here")).toBeTruthy();
    expect(getByText("Try the picker above")).toBeTruthy();
  });

  it("starts collapsed when defaultExpanded=false", () => {
    const { queryByText } = renderWithTheme(
      <WorkoutSection title="Collapsed" defaultExpanded={false}>
        <Text>Hidden</Text>
      </WorkoutSection>,
    );
    expect(queryByText("Hidden")).toBeNull();
  });
});
