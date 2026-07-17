import type { CSSProperties, ReactNode } from "react";
import { useScreenCycle } from "./hooks";

/**
 * The tilting iPhone frame (notch, halo, hover-tilt). Renders either a real
 * `screenshot` or a set of `screens` that auto-crossfade (pausing on hover,
 * static under reduced motion — see useScreenCycle). Used by the hero and the
 * coach section.
 */
export function PhoneDevice({
  screens,
  screenshot,
  outerClassName = "hero-phone",
  haloColor,
  style,
}: {
  screens: ReactNode[];
  screenshot?: string | null;
  outerClassName?: string;
  haloColor?: string;
  style?: CSSProperties;
}) {
  const { index, setPaused } = useScreenCycle(screens.length);

  return (
    <div
      className={outerClassName}
      data-reveal
      style={style}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="phone-halo"
        style={haloColor ? ({ "--halo": haloColor } as CSSProperties) : undefined}
      />
      <div className="phone-frame">
        <div className="phone-notch" />
        <div className="phone-screen">
          {screenshot ? (
            <img className="phone-shot" src={screenshot} alt="Persistence app screen" />
          ) : (
            <div className="app-screens">
              {screens.map((screen, i) => (
                <div
                  key={i}
                  className={`app-screen${i === index ? " active" : ""}`}
                  aria-hidden={i !== index}
                >
                  {screen}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
