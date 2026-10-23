import React from "react";
import { Stop, Svg } from "react-native-svg";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { ScreenGlow } from "../ScreenGlow";

/** The one screen background: a faint primary glow at the top, behind everything. */
it("draws the canvas glow: 90% × 40% ellipse centred at 50% / 12%, primary at 9% fading out by 70%", () => {
  const r = renderWithTheme(<ScreenGlow />);
  const svg = r.UNSAFE_getByType(Svg).props as Record<string, unknown>;
  expect(svg.testID).toBe("screen-glow");
  expect(svg.pointerEvents).toBe("none");
  expect(svg.accessibilityElementsHidden).toBe(true);
  expect(svg.importantForAccessibility).toBe("no-hide-descendants");
  // The svg mock renders every child element as a View, so pick by prop.
  const ellipse = r.UNSAFE_getByProps({ fill: "url(#screen-glow)" })
    .props as Record<string, unknown>;
  expect([ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry]).toEqual([
    "50%",
    "12%",
    "90%",
    "40%",
  ]);
  const stops = r
    .UNSAFE_getAllByType(Stop)
    .map((s) => s.props as Record<string, unknown>)
    .filter((p) => p.stopColor !== undefined);
  expect(stops.map((s) => [s.offset, s.stopOpacity])).toEqual([
    ["0", 0.09],
    ["0.7", 0],
    ["1", 0],
  ]);
});
