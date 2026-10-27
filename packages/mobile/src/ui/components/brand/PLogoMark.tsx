import Svg, { Path } from "react-native-svg";
import { color as tokens } from "@/ui/theme/tokens";
import { P_LOGO_PATHS, P_LOGO_VIEWBOX } from "./pLogoPaths";

/** The static P mark: the app icon's logo at any size. Decorative. */
export function PLogoMark({
  size = 16,
  color = tokens.$primary,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size * 0.9}
      height={size}
      viewBox={P_LOGO_VIEWBOX}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="p-logo-mark"
    >
      {P_LOGO_PATHS.map((p) => (
        <Path key={p.transform} d={p.d} transform={p.transform} fill={color} />
      ))}
    </Svg>
  );
}
