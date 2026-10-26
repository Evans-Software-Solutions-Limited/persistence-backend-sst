import React from "react";
import { muscleShare } from "@/domain/services/workoutSummary";
import { color } from "@/ui/theme/tokens";
import { MUSCLE_SHADES, MuscleMap } from "../MuscleMap";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("MuscleMap", () => {
  it("draws front and back under one label, shaded from the share", () => {
    const muscles = muscleShare([
      { primary: ["quadriceps"], secondary: [], completedSets: 4 },
      { primary: ["hamstrings"], secondary: [], completedSets: 1 },
    ]);
    const r = renderWithTheme(<MuscleMap muscles={muscles} height={200} />);
    const map = r.getByLabelText("Muscles worked: quads 80%, hamstrings 20%");
    expect(map.props.accessibilityRole).toBe("image");
    // The library labels each figure; both sit inside the one label.
    expect(
      r.UNSAFE_getAllByProps({ accessibilityLabel: "male-body-front" }),
    ).toHaveLength(1);
    expect(
      r.UNSAFE_getAllByProps({ accessibilityLabel: "male-body-back" }),
    ).toHaveLength(1);
    // Quads at full primary; hamstrings (0.25 of quads) at level 2, half.
    expect(
      r.UNSAFE_getAllByProps({ id: "quadriceps", fill: color.$primary }).length,
    ).toBeGreaterThan(0);
    expect(
      r.UNSAFE_getAllByProps({ id: "hamstring", fill: MUSCLE_SHADES[1] })
        .length,
    ).toBeGreaterThan(0);
    expect(
      r.UNSAFE_getAllByProps({ id: "chest", fill: color.$bodyMapIdle }).length,
    ).toBeGreaterThan(0);
    expect(
      r.UNSAFE_getAllByProps({ id: "head", fill: color.$surface4 }).length,
    ).toBeGreaterThan(0);
    expect(r.UNSAFE_queryAllByProps({ id: "hair" })).toHaveLength(0);
  });

  it("defaults to the canvas size", () => {
    const r = renderWithTheme(<MuscleMap muscles={muscleShare([])} />);
    expect(r.getByLabelText("No muscles worked")).toBeTruthy();
  });
});
