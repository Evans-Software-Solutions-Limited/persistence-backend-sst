import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * Tiny SVG line graph used inside the MyProgress tiles (body weight /
 * body fat / steps). Ported verbatim from
 * `persistence-mobile/components/home/SimpleLineGraph/`.
 */

interface SimpleLineGraphProps {
  readonly data: number[];
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

export function SimpleLineGraph({
  data,
  width,
  height,
  color,
}: SimpleLineGraphProps) {
  if (data.length === 0) {
    return <View style={{ width, height }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // Avoid division by zero

  const padding = 4;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * graphWidth;
    const y = padding + graphHeight - ((value - min) / range) * graphHeight;
    return `${x},${y}`;
  });

  return (
    <Svg width={width} height={height}>
      <Path
        d={`M ${points.join(" L ")}`}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
