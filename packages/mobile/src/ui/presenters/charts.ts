/**
 * SVG sparkline geometry (06-progress-goals, Phases 06.9 + 06.10). Pure — the
 * design.md § BodyTrendPresenter wraps the path maths in `computePath` so the
 * chart lib is swappable (e.g. victory-native) later. Shared by the WeighIn
 * preview + the You/Progress body-trend sparkline.
 */

export type ChartDims = { w: number; h: number };

export type SparklinePath = {
  /** `M…L…` line path. */
  line: string;
  /** Closed area path (line + baseline) for the gradient fill. */
  area: string;
  /** [x, y] of the last point (for the trailing dot). */
  lastPoint: [number, number];
  /** All [x, y] points. */
  points: [number, number][];
};

/**
 * Map a numeric series to an SVG path over `dims`. Y is inverted (SVG origin
 * top-left). A flat series renders a mid-height line (avoids divide-by-zero).
 * `padFrac` pads the value range so the line isn't flush to the edges.
 */
export function computePath(
  series: readonly number[],
  dims: ChartDims,
  padFrac = 0,
): SparklinePath {
  const { w, h } = dims;
  if (series.length === 0) {
    return { line: "", area: "", lastPoint: [0, h], points: [] };
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const pad = (max - min) * padFrac;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo;

  const points: [number, number][] = series.map((v, i) => {
    const x = series.length === 1 ? 0 : (i / (series.length - 1)) * w;
    const y = span === 0 ? h / 2 : h - ((v - lo) / span) * h;
    return [x, y];
  });

  const line = points
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(" ");
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return { line, area, lastPoint: points[points.length - 1], points };
}
