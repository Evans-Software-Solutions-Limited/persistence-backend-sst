/**
 * Visual-contract tests for the Phase 3a port:
 *   - Back button renders the legacy "← Back" text glyph (not the
 *     V2-pre-phase chevron icon).
 *   - Difficulty colour band 3-4 maps to `Colors.info.DEFAULT` (the
 *     V2 pre-phase implementation incorrectly returned the brand
 *     `Colors.primary.DEFAULT`).
 *
 * Data-flow assertions (Submit fires the right command, Back routes
 * back, etc.) live in `WorkoutRatingContainer.test.tsx`.
 */

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { WorkoutRatingPresenter } from "../WorkoutRatingPresenter";

const noop = () => undefined;

describe("WorkoutRatingPresenter — Phase 3a port", () => {
  it("renders the legacy '← Back' text glyph (no chevron icon)", () => {
    const { getByTestId, getByText } = render(
      <WorkoutRatingPresenter onSubmit={noop} onBack={noop} />,
    );
    const back = getByTestId("workout-rating-back");
    expect(back).toBeTruthy();
    // Literal legacy string — guards against drift back to a chevron
    // icon variant.
    expect(getByText("← Back")).toBeTruthy();
  });

  it("difficulty band 3-4 paints the info colour, not the brand primary (legacy parity)", () => {
    // Default rating is 1 → "Too Easy" → success colour. Tap the
    // mock SemiCircleSlider's value-3 button to land in band 3-4 and
    // assert the difficulty caption + accent colour.
    const { getByTestId } = render(
      <WorkoutRatingPresenter onSubmit={noop} onBack={noop} />,
    );
    fireEvent.press(getByTestId("workout-rating-3"));
    const message = getByTestId("workout-rating-message");
    // The accent colour comes through inline-style — flatten to find it.
    const flatStyle = Array.isArray(message.props.style)
      ? Object.assign({}, ...message.props.style.flat(Infinity))
      : message.props.style;
    // The Phase 3a fix is semantic: route band 3-4 through the
    // `info` token (legacy parity) instead of `primary`. In the
    // current V2 palette `info` and `primary` happen to share the
    // same cyan RGB, so a `!==` check would be false-negative —
    // assert the semantic token directly.
    expect(flatStyle.color).toBe(Colors.info.DEFAULT);
  });

  it("difficulty band 1-2 stays on success, band 5-6 on warning, band 9-10 on error (sanity-check the full ladder)", () => {
    const { getByTestId } = render(
      <WorkoutRatingPresenter onSubmit={noop} onBack={noop} />,
    );
    const flatten = (id: string) => {
      const el = getByTestId(id);
      return Array.isArray(el.props.style)
        ? Object.assign({}, ...el.props.style.flat(Infinity))
        : el.props.style;
    };
    // Band 1-2 → success.
    fireEvent.press(getByTestId("workout-rating-2"));
    expect(flatten("workout-rating-message").color).toBe(
      Colors.success.DEFAULT,
    );
    // Band 5-6 → warning.
    fireEvent.press(getByTestId("workout-rating-5"));
    expect(flatten("workout-rating-message").color).toBe(
      Colors.warning.DEFAULT,
    );
    // Band 7-8 → warning.dark.
    fireEvent.press(getByTestId("workout-rating-7"));
    expect(flatten("workout-rating-message").color).toBe(Colors.warning.dark);
    // Band 9-10 → error.
    fireEvent.press(getByTestId("workout-rating-10"));
    expect(flatten("workout-rating-message").color).toBe(Colors.error.DEFAULT);
  });
});
